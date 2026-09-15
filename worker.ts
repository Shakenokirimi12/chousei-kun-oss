/**
 * Cloudflare Workers の最終エントリポイント。
 *
 * - fetch: OpenNext がビルドした worker.js の handler に委譲（既存の Next.js リクエスト処理を維持）
 * - scheduled: Cron Trigger で 15 分毎に Office Hour 主催者の予定を同期
 *
 * このファイルを wrangler.jsonc の "main" に指定する。OpenNext のビルドは
 * `.open-next/worker.js` を生成するので、デプロイ手順は変わらない（このファイルから
 * import するだけ）。
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- @ts-expect-error would break once .open-next/worker.js exists locally (post-build); this import only errors on a fresh, unbuilt checkout
// @ts-ignore: generated file
import openNextWorker from "./.open-next/worker.js";
import { syncAllActive } from "./src/server/cron/sync-host-busy";
import { ChouseiMcpAgent, type McpProps } from "./src/server/mcp/agent";
import { enforceRateLimit, type RateLimitBinding } from "./src/server/api/rate-limit";
import { isMaintenanceMode, MAINTENANCE_JSON_BODY, MAINTENANCE_RETRY_AFTER_SECONDS } from "./src/lib/maintenance";

// Durable Object クラス類は OpenNext が同 worker から re-export している前提なので
// type 抽出 + 再エクスポートが必要。OpenNext のテンプレ通り、wrangler の bundling 時に
// `.open-next/worker.js` 側の export を引き継ぐ。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- see note above
// @ts-ignore: generated file
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

// リモート MCP サーバー用の Durable Object。wrangler.jsonc の durable_objects.bindings
// で参照するには、main に指定されたこのファイルから名前付き export されている必要がある。
//
// `agents/mcp` は `cloudflare:workers` の DurableObject を継承するため、Next.js の
// ビルドグラフ（src/app 以下）から import すると `next build` のページデータ収集が
// 素の Node.js で行われて解決に失敗する。そのため MCP のルーティングは Next.js の
// API Route にはせず、ここ（wrangler 専用エントリポイント）でだけ扱う。
export { ChouseiMcpAgent };

type Env = {
    DB: D1Database;
    MCP_AGENT: DurableObjectNamespace<ChouseiMcpAgent>;
    WRITE_RATE_LIMITER?: RateLimitBinding;
};

const mcpHandler = ChouseiMcpAgent.serve("/api/mcp", { binding: "MCP_AGENT" });

/**
 * MCP は OpenNext（= Next.js の proxy とHono のミドルウェア）を通らないので、
 * そちらで掛けているメンテナンスモードと書き込みレート制限をここで同等に掛ける。
 * 掛けないと、メンテ中も MCP 経由の書き込みが通り、管理パスワードの総当たりも
 * 無制限になる（HTTP 側は AUTH_RATE_LIMITER / WRITE_RATE_LIMITER で抑えている）。
 */
async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (await isMaintenanceMode(env)) {
        return Response.json(MAINTENANCE_JSON_BODY, {
            status: 503,
            headers: { "Retry-After": String(MAINTENANCE_RETRY_AFTER_SECONDS) },
        });
    }

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (request.method === "POST") {
        const allowed = await enforceRateLimit(env.WRITE_RATE_LIMITER, `mcp:${ip}`);
        if (!allowed) {
            return Response.json({ error: "試行回数が多すぎます。しばらくしてから再度お試しください。" }, { status: 429 });
        }
    }

    // McpAgent は ctx.props を Durable Object の this.props として渡す。ctx.props は
    // 読み取り専用なので、メソッドを束縛した別オブジェクトに props を載せて渡す。
    const props: McpProps = { ip };
    const mcpCtx = {
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException: ctx.passThroughOnException.bind(ctx),
        props,
    } as unknown as ExecutionContext;
    return mcpHandler.fetch(request, env, mcpCtx);
}

const worker = {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        if (url.pathname === "/api/mcp" || url.pathname.startsWith("/api/mcp/")) {
            return handleMcp(request, env, ctx);
        }
        return openNextWorker.fetch(request, env, ctx);
    },

    /**
     * Cron Trigger ハンドラ。wrangler.jsonc の triggers.crons で発火する。
     * 実装の本体は src/server/cron/sync-host-busy.ts。
     */
    async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(
            (async () => {
                try {
                    const result = await syncAllActive(env);
                    console.log(`[cron] sync-host-busy total=${result.total} ok=${result.ok} failed=${result.failed}`);
                } catch (e) {
                    console.error("[cron] sync-host-busy fatal", e);
                }
            })()
        );
    },
};

export default worker;
