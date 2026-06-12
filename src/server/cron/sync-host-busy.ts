/**
 * 主催者の予定を 15 分間隔で同期する Cron ジョブのコア実装。
 *
 * 入口は Cloudflare Workers の scheduled handler で、ここでは
 * D1 バインディングだけを受け取って、active な Office Hour ごとに
 * Google Calendar と大学(Campus Square)の busy 予定を取得しキャッシュする。
 *
 * 1人の主催者の失敗は他に影響させない（catch して lastSyncError に記録、続行）。
 */
import { createDb } from "@/server/db/client";
import { createOfficeHourService } from "@/server/services/officeHour/officeHour.service";
import { refreshGoogleTokenIfNeeded } from "@/server/api/utils";
import { resolveDateRange } from "@/server/services/officeHour/slotGenerator";
import { safeFetchText } from "@/lib/safe-fetch";
import { parseICal } from "@/lib/ical";

type Bindings = { DB: D1Database };

const GOOGLE_FETCH_TIMEOUT_MS = 10_000;

async function fetchGoogleBusy(opts: {
    accessToken: string;
    timeMin: string;
    timeMax: string;
}): Promise<{ startMs: number; endMs: number; summary?: string }[]> {
    // ユーザーが選んだ全カレンダーから busy を集める
    const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
    });
    if (!listRes.ok) throw new Error(`google calendarList ${listRes.status}`);
    const list = (await listRes.json()) as { items?: Array<{ id: string }> };
    const calendarIds = (list.items ?? []).map((c) => c.id).slice(0, 10);

    const events: { startMs: number; endMs: number; summary?: string }[] = [];
    for (const calId of calendarIds) {
        const evRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(opts.timeMin)}&timeMax=${encodeURIComponent(opts.timeMax)}&maxResults=250`,
            {
                headers: { Authorization: `Bearer ${opts.accessToken}` },
                signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
            }
        );
        if (!evRes.ok) continue; // 一部カレンダーの失敗は無視
        const data = (await evRes.json()) as {
            items?: Array<{
                summary?: string;
                start?: { dateTime?: string; date?: string };
                end?: { dateTime?: string; date?: string };
                transparency?: string;
            }>;
        };
        for (const item of data.items ?? []) {
            if (item.transparency === "transparent") continue; // free 予定は無視
            const startIso = item.start?.dateTime ?? item.start?.date;
            const endIso = item.end?.dateTime ?? item.end?.date;
            if (!startIso || !endIso) continue;
            const startMs = Date.parse(startIso);
            const endMs = Date.parse(endIso);
            if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
            events.push({ startMs, endMs, summary: item.summary });
        }
    }
    return events;
}

/**
 * 1 つの Office Hour の busy 予定を同期する。
 * Google と Campus は独立に try/catch し、片方の失敗で他方をブロックしない。
 */
export async function syncOneOfficeHour(env: Bindings, officeHourId: string): Promise<{ ok: boolean; error?: string }> {
    const db = createDb(env.DB);
    const svc = createOfficeHourService(db);
    const creds = await svc.getHostCredentials(officeHourId);
    if (!creds) return { ok: false, error: "office hour not found" };

    const range = resolveDateRange({ startDate: creds.startDate, endDate: creds.endDate });
    const timeMin = new Date(range.startDate).toISOString();
    const timeMax = new Date(range.endDate + 24 * 60 * 60 * 1000).toISOString();
    const partialErrors: string[] = [];

    // Google
    try {
        const session = await refreshGoogleTokenIfNeeded(db, creds.hostGoogleSessionId);
        if (!session) throw new Error("google session expired");
        const events = await fetchGoogleBusy({
            accessToken: session.accessToken,
            timeMin,
            timeMax,
        });
        await svc.replaceHostBusy(officeHourId, "google", events);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[cron:sync-host-busy:google] ${officeHourId}`, msg);
        partialErrors.push(`google:${msg}`);
    }

    // 大学カレンダー (iCal URL)
    try {
        const icalText = await safeFetchText(creds.hostIcalUrl);
        const calEvents = parseICal(icalText);
        const mapped = calEvents
            .map((ev) => ({
                startMs: Date.parse(ev.dtstart),
                endMs: Date.parse(ev.dtend),
                summary: ev.summary,
            }))
            .filter((e) => !Number.isNaN(e.startMs) && !Number.isNaN(e.endMs))
            // 受付期間 + 1日のバッファに収める
            .filter((e) => e.endMs >= range.startDate && e.startMs <= range.endDate + 24 * 60 * 60 * 1000);
        await svc.replaceHostBusy(officeHourId, "campus", mapped);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[cron:sync-host-busy:ical] ${officeHourId}`, msg);
        partialErrors.push(`ical:${msg}`);
    }

    const ok = partialErrors.length === 0;
    await svc.setSyncMeta(officeHourId, { ok, error: partialErrors.join(" | ") });
    return ok ? { ok: true } : { ok: false, error: partialErrors.join(" | ") };
}

/**
 * 全 active な Office Hour を順次同期する。エラーは個別に握って続行。
 */
export async function syncAllActive(env: Bindings): Promise<{ total: number; ok: number; failed: number }> {
    const db = createDb(env.DB);
    const svc = createOfficeHourService(db);
    const active = await svc.listActive();
    let ok = 0;
    let failed = 0;
    for (const a of active) {
        const r = await syncOneOfficeHour(env, a.id);
        if (r.ok) ok++; else failed++;
    }
    return { total: active.length, ok, failed };
}
