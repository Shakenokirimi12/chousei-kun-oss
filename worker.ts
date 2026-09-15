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
import { ChouseiMcpAgent } from "./src/server/mcp/agent";

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
};

const mcpHandler = ChouseiMcpAgent.serve("/api/mcp", { binding: "MCP_AGENT" });

const worker = {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        if (url.pathname === "/api/mcp" || url.pathname.startsWith("/api/mcp/")) {
            return mcpHandler.fetch(request, env, ctx);
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
