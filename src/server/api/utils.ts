import { eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import { googleOauthSessions } from "@/server/db/schema";
import { CUSTOM_PERIODS } from "@/config/periods";
import type { CandidateWindow } from "@/types";
import { encryptToken, decryptToken } from "@/lib/token-crypto";

export const GOOGLE_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export const GOOGLE_CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const AVAILABILITY_INSERT_BATCH_SIZE = 20;

export function getEnvOrThrow(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
}

export function encodeState(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeState<T>(state: string): T {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as T;
}

export function parseCookieValue(cookieHeader: string, key: string): string | undefined {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
    return match?.[1];
}

export function cookieSecurityAttr(requestUrl: string): string {
    const isHttps = requestUrl.startsWith("https://");
    return isHttps ? "; Secure" : "";
}

export function formatJstDateTime(datePart: string, hhmm: string): string {
    const [hourRaw, minuteRaw] = hhmm.split(":");
    const hour = String(Number(hourRaw)).padStart(2, "0");
    const minute = String(Number(minuteRaw)).padStart(2, "0");
    return `${datePart}T${hour}:${minute}:00+09:00`;
}

export function parseCandidateWindow(candidate: string): CandidateWindow | null {
    const [datePart, slotRaw] = candidate.split("_");
    if (!datePart || !slotRaw) return null;

    const slotType = slotRaw.charAt(0);
    const slotId = Number.parseInt(slotRaw.slice(1), 10);
    if (Number.isNaN(slotId)) return null;

    if (slotType === "P") {
        const period = CUSTOM_PERIODS.find((p) => p.id === slotId);
        if (!period) return null;
        const [startHm, endHm] = period.time.split("-");
        return {
            startDateTime: formatJstDateTime(datePart, startHm),
            endDateTime: formatJstDateTime(datePart, endHm),
        };
    }

    if (slotType === "H") {
        const startHour = Math.max(0, Math.min(23, slotId));
        const endHour = Math.min(24, startHour + 1);
        const startHm = `${String(startHour).padStart(2, "0")}:00`;
        const endHm = `${String(endHour).padStart(2, "0")}:00`;
        return {
            startDateTime: formatJstDateTime(datePart, startHm),
            endDateTime: formatJstDateTime(datePart, endHm),
        };
    }

    return null;
}

/**
 * セッションを取得し、必要ならアクセストークンをリフレッシュする。
 * 戻り値の accessToken / refreshToken は復号済み（平文）。
 */
export async function refreshGoogleTokenIfNeeded(db: DbClient, sessionId: string) {
    const record = await db.query.googleOauthSessions.findFirst({
        where: eq(googleOauthSessions.sessionId, sessionId),
    });
    if (!record) return null;

    const refreshToken = await decryptToken(record.refreshToken);
    const decryptedRecord = {
        ...record,
        accessToken: (await decryptToken(record.accessToken))!,
        refreshToken,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (decryptedRecord.expiresAt > nowSec + 60) return decryptedRecord;
    if (!refreshToken) return decryptedRecord;

    const clientId = getEnvOrThrow("GOOGLE_CLIENT_ID");
    const clientSecret = getEnvOrThrow("GOOGLE_CLIENT_SECRET");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return decryptedRecord;
    const tokenJson = await tokenRes.json() as { access_token: string; expires_in: number };
    const updatedExpiresAt = Math.floor(Date.now() / 1000) + tokenJson.expires_in;
    await db
        .update(googleOauthSessions)
        .set({
            accessToken: (await encryptToken(tokenJson.access_token))!,
            expiresAt: updatedExpiresAt,
            updatedAt: Date.now(),
        })
        .where(eq(googleOauthSessions.sessionId, sessionId));

    return {
        ...decryptedRecord,
        accessToken: tokenJson.access_token,
        expiresAt: updatedExpiresAt,
    };
}

export async function getGoogleSessionAndScopes(db: DbClient, sessionId: string) {
    const session = await refreshGoogleTokenIfNeeded(db, sessionId);
    if (!session) {
        return { session: null, scopes: [] as string[] };
    }

    // access_token を URL クエリに載せると Referer/ログに残るため、
    // Authorization ヘッダ経由で問い合わせる。
    const tokenInfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/tokeninfo",
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ access_token: session.accessToken }),
            signal: AbortSignal.timeout(10_000),
        }
    );
    if (!tokenInfoRes.ok) {
        return { session, scopes: [] as string[] };
    }

    const tokenInfo = await tokenInfoRes.json() as { scope?: string };
    const scopes = tokenInfo.scope?.split(" ").filter(Boolean) ?? [];
    return { session, scopes };
}

export async function insertAvailabilitiesInBatches(
    db: DbClient,
    rows: Array<{ id: string; participantId: string; candidateIdx: number; status: number }>
) {
    const { availabilities } = await import("@/server/db/schema");
    for (let i = 0; i < rows.length; i += AVAILABILITY_INSERT_BATCH_SIZE) {
        const chunk = rows.slice(i, i + AVAILABILITY_INSERT_BATCH_SIZE);
        await db.insert(availabilities).values(chunk);
    }
}
