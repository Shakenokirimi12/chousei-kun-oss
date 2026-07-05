/**
 * Wana (Sentry 互換) エラーレポータ。
 *
 * SDK には依存せず、Sentry の envelope 形式を手組みして ingest に POST する
 * 同型 (isomorphic) クライアント。ブラウザでも Cloudflare Workers ランタイムでも
 * そのまま動く。
 *
 * - 認証は DSN の public key を `?sentry_key=` クエリで渡す。
 * - Content-Type を `text/plain` にして CORS の simple request に収め、
 *   ブラウザからのプリフライトを回避する。
 * - レポート送信は決してアプリ側に例外を投げない（送信失敗は戻り値で表現）。
 *
 * DSN は `NEXT_PUBLIC_WANA_DSN` から読む。public key は元来公開情報なので
 * クライアントへ inline されても問題ない。
 */

export type WanaLevel = "fatal" | "error" | "warning" | "info" | "debug";

export interface WanaContext {
    level?: WanaLevel;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    /** サーバ側のリクエスト情報（任意） */
    request?: { method?: string; url?: string };
}

export interface WanaResult {
    ok: boolean;
    eventId?: string;
    status?: number;
    error?: string;
}

interface Dsn {
    protocol: string;
    publicKey: string;
    host: string;
    projectId: string;
}

function getDsn(): string | undefined {
    // NEXT_PUBLIC_ はビルド時にクライアント／サーバ双方へ inline される。
    const dsn = process.env.NEXT_PUBLIC_WANA_DSN;
    return dsn && dsn.trim() ? dsn.trim() : undefined;
}

/**
 * ブラウザからの送信に使う同一オリジンのトンネルパス。
 * ingest ドメインへの直接 POST は URL に `/envelope/?sentry_key=` を含み、
 * EasyPrivacy 系の広告ブロッカーに Sentry として遮断されることが多い。
 * 同一オリジンの API パスなら遮断されず、CORS / CSP の影響も受けない。
 */
export const WANA_TUNNEL_PATH = "/api/wana/envelope";

function parseDsn(dsn: string): Dsn | null {
    try {
        const u = new URL(dsn);
        const projectId = u.pathname.replace(/^\/+/, "");
        if (!u.username || !u.host || !projectId) return null;
        return {
            protocol: u.protocol.replace(/:$/, ""),
            publicKey: u.username,
            host: u.host,
            projectId,
        };
    } catch {
        return null;
    }
}

function isBrowser(): boolean {
    return typeof window !== "undefined" && typeof window.document !== "undefined";
}

/** Sentry の event_id は 32 桁の hex（ダッシュ無し UUID 相当）。 */
function makeEventId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** V8 形式のスタック（`    at fn (file:line:col)`）を Sentry frames に変換。 */
function parseStackFrames(stack: string | undefined): Array<Record<string, unknown>> {
    if (!stack) return [];
    const frames: Array<Record<string, unknown>> = [];
    for (const line of stack.split("\n")) {
        const m = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
        if (!m) continue;
        frames.push({
            function: m[1] || "<anonymous>",
            filename: m[2],
            lineno: Number(m[3]),
            colno: Number(m[4]),
            in_app: !m[2].includes("node_modules"),
        });
    }
    // Sentry は古いフレームが先頭（最後が throw 地点）。
    return frames.reverse();
}

function toError(error: unknown): Error {
    if (error instanceof Error) return error;
    if (typeof error === "string") return new Error(error);
    try {
        return new Error(JSON.stringify(error));
    } catch {
        return new Error(String(error));
    }
}

function buildEvent(error: unknown, ctx: WanaContext, eventId: string): Record<string, unknown> {
    const err = toError(error);
    const runtime = isBrowser() ? "browser" : "worker";
    const frames = parseStackFrames(err.stack);

    const event: Record<string, unknown> = {
        event_id: eventId,
        timestamp: Date.now() / 1000,
        platform: "javascript",
        level: ctx.level ?? "error",
        logger: "wana-chousei",
        environment: process.env.NODE_ENV ?? "production",
        server_name: runtime,
        tags: { runtime, ...ctx.tags },
        exception: {
            values: [
                {
                    type: err.name || "Error",
                    value: err.message,
                    ...(frames.length ? { stacktrace: { frames } } : {}),
                },
            ],
        },
    };
    if (ctx.extra) event.extra = ctx.extra;
    if (ctx.request) event.request = ctx.request;
    if (isBrowser()) {
        event.request = {
            url: window.location.href,
            headers: { "User-Agent": navigator.userAgent },
            ...(ctx.request ?? {}),
        };
    }
    return event;
}

function buildEnvelope(dsn: Dsn, event: Record<string, unknown>, eventId: string): string {
    const header = JSON.stringify({
        event_id: eventId,
        sent_at: new Date().toISOString(),
        dsn: `${dsn.protocol}://${dsn.publicKey}@${dsn.host}/${dsn.projectId}`,
    });
    const itemHeader = JSON.stringify({ type: "event" });
    const payload = JSON.stringify(event);
    return `${header}\n${itemHeader}\n${payload}\n`;
}

/** DSN から ingest の envelope エンドポイント URL を組み立てる（サーバ側トンネルでも使用）。 */
export function getWanaIngestUrl(): string | null {
    const dsnStr = getDsn();
    if (!dsnStr) return null;
    const dsn = parseDsn(dsnStr);
    if (!dsn) return null;
    return (
        `${dsn.protocol}://${dsn.host}/api/${encodeURIComponent(dsn.projectId)}` +
        `/envelope/?sentry_key=${encodeURIComponent(dsn.publicKey)}`
    );
}

/** 正規化した DSN 文字列（envelope ヘッダに書く形式）。トンネル側の検証にも使う。 */
export function getNormalizedDsn(): string | null {
    const dsnStr = getDsn();
    if (!dsnStr) return null;
    const dsn = parseDsn(dsnStr);
    if (!dsn) return null;
    return `${dsn.protocol}://${dsn.publicKey}@${dsn.host}/${dsn.projectId}`;
}

async function postEnvelope(url: string, body: string): Promise<{ ok: boolean; status: number }> {
    const res = await fetch(url, {
        method: "POST",
        // text/plain に収めて CORS preflight を避ける（ブラウザ）。
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body,
        // ページ離脱中でも送り切れるように（ブラウザのみ）。
        ...(isBrowser() ? { keepalive: true } : {}),
    });
    return { ok: res.ok, status: res.status };
}

/**
 * 例外を Wana に送信する。アプリ側に例外を伝播させず、結果を戻り値で返す。
 * DSN 未設定時は no-op（`ok:false` + error 文言）。
 *
 * ブラウザでは同一オリジンのトンネル（WANA_TUNNEL_PATH）を優先し、
 * 失敗時（メンテナンスモード等）のみ ingest へ直送する。サーバは常に直送。
 */
export async function captureException(error: unknown, ctx: WanaContext = {}): Promise<WanaResult> {
    const dsnStr = getDsn();
    if (!dsnStr) return { ok: false, error: "NEXT_PUBLIC_WANA_DSN is not configured" };
    const dsn = parseDsn(dsnStr);
    if (!dsn) return { ok: false, error: "NEXT_PUBLIC_WANA_DSN is invalid" };

    const eventId = makeEventId();
    try {
        const event = buildEvent(error, ctx, eventId);
        const body = buildEnvelope(dsn, event, eventId);
        const directUrl = getWanaIngestUrl() as string;

        if (isBrowser()) {
            try {
                const viaTunnel = await postEnvelope(WANA_TUNNEL_PATH, body);
                if (viaTunnel.ok) return { ok: true, eventId, status: viaTunnel.status };
            } catch {
                // トンネル不達（オフライン・メンテ等）は直送にフォールバック
            }
        }

        const res = await postEnvelope(directUrl, body);
        if (!res.ok) {
            return { ok: false, eventId, status: res.status, error: `ingest responded ${res.status}` };
        }
        return { ok: true, eventId, status: res.status };
    } catch (e) {
        return { ok: false, eventId, error: e instanceof Error ? e.message : String(e) };
    }
}

/** 任意メッセージをイベントとして送る薄いヘルパー。 */
export async function captureMessage(message: string, ctx: WanaContext = {}): Promise<WanaResult> {
    return captureException(new Error(message), { level: "info", ...ctx });
}

/** DSN が設定済みか（テストページの表示分岐などに使う）。 */
export function isWanaConfigured(): boolean {
    return !!getDsn() && !!parseDsn(getDsn() as string);
}
