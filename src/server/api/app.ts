import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { eventsRoutes, googleRoutes, usersRoutes, officeHoursRoutes, adminRoutes } from "./routes";
import { syncCalendarSchema, syncICalSchema } from "./schemas";
import { CampusSquareService } from "@/lib/campus-square";
import { parseICal } from "@/lib/ical";
import { safeFetchText } from "@/lib/safe-fetch";
import { captureException, getWanaIngestUrl, getNormalizedDsn } from "@/lib/wana";

type Bindings = {
    DB: D1Database;
    OPENCODE_API_KEY: string;
};

export const apiApp = new Hono<{ Bindings: Bindings }>().basePath("/api");

apiApp.route("/events", eventsRoutes);
apiApp.route("/google", googleRoutes);
apiApp.route("/users", usersRoutes);
apiApp.route("/office-hours", officeHoursRoutes);
apiApp.route("/admin", adminRoutes);

apiApp.post("/sync-calendar", sValidator("json", syncCalendarSchema), async (c) => {
    if (process.env.NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE !== "true") {
        return c.json({ error: "Campus Square integration is disabled." }, 404);
    }

    const { uid, pass } = c.req.valid("json");
    const result = await CampusSquareService.fetchCalendarWithUrl(uid, pass);
    return c.json({ events: result.events, icalUrl: result.icalUrl });
});

apiApp.post("/sync-ical", sValidator("json", syncICalSchema), async (c) => {
    const { url } = c.req.valid("json");
    try {
        const icalData = await safeFetchText(url);
        const events = parseICal(icalData);
        return c.json({ events });
    } catch (error) {
        console.error("[sync-ical]", error);
        return c.json({ error: "Failed to fetch or parse iCal URL" }, 400);
    }
});

/** envelope の最大サイズ。イベント1件＋スタックトレースには十分な余裕。 */
const WANA_ENVELOPE_MAX_BYTES = 200_000;

/**
 * ブラウザ → Wana の同一オリジントンネル（Sentry の tunnel オプション相当）。
 * ingest ドメインへの直接 POST は広告ブロッカー（EasyPrivacy の
 * `/envelope/?sentry_key=` パターン）に遮断されるため、クライアントは
 * まずこのパスに envelope を送り、Worker が ingest へ中継する。
 * 自プロジェクトの DSN を持つ envelope 以外は中継しない。
 */
apiApp.post("/wana/envelope", async (c) => {
    const ingestUrl = getWanaIngestUrl();
    const expectedDsn = getNormalizedDsn();
    if (!ingestUrl || !expectedDsn) {
        return c.json({ error: "Wana is not configured" }, 501);
    }

    const body = await c.req.text();
    if (!body || body.length > WANA_ENVELOPE_MAX_BYTES) {
        return c.json({ error: "Invalid envelope" }, 400);
    }
    try {
        const header = JSON.parse(body.slice(0, body.indexOf("\n"))) as { dsn?: string };
        if (header.dsn !== expectedDsn) {
            return c.json({ error: "Invalid envelope" }, 400);
        }
    } catch {
        return c.json({ error: "Invalid envelope" }, 400);
    }

    try {
        const res = await fetch(ingestUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body,
            signal: AbortSignal.timeout(10_000),
        });
        return c.json({ ok: res.ok }, res.ok ? 200 : 502);
    } catch {
        return c.json({ ok: false }, 502);
    }
});

/**
 * dev 限定の Wana 疎通テスト。バックエンド→Wana の送信経路を実際に叩き、
 * 結果（ok / eventId / status）をそのまま返す。フロントの dev テストページから
 * 呼んで「ちゃんと流れているか」を確認するために使う。本番では 404。
 */
apiApp.get("/wana/selftest", async (c) => {
    if (process.env.NODE_ENV === "production") {
        return c.json({ error: "Not found" }, 404);
    }
    const result = await captureException(
        new Error("Wana backend self-test (intentional, not a real error)"),
        {
            level: "info",
            tags: { source: "selftest-backend" },
            request: { method: c.req.method, url: c.req.url },
        }
    );
    return c.json(result, result.ok ? 200 : 502);
});

apiApp.onError((error, c) => {
    console.error("[API Error]", error);
    // Wana へは fire-and-forget。エラー応答をブロックしない。
    const report = captureException(error, {
        tags: { source: "api" },
        request: { method: c.req.method, url: c.req.url },
    });
    try {
        // Workers では応答後も送信を完了させる。
        c.executionCtx.waitUntil(report);
    } catch {
        // dev / Node ランタイムには executionCtx が無い場合がある。浮かせて実行。
        void report;
    }
    return c.json({ error: "Internal Server Error" }, 500);
});
