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
// @ts-ignore: generated file
import openNextWorker from "./.open-next/worker.js";
import { syncAllActive } from "./src/server/cron/sync-host-busy";

// Durable Object クラス類は OpenNext が同 worker から re-export している前提なので
// type 抽出 + 再エクスポートが必要。OpenNext のテンプレ通り、wrangler の bundling 時に
// `.open-next/worker.js` 側の export を引き継ぐ。
// @ts-ignore: generated file
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

type Env = {
    DB: D1Database;
};


export default {
    fetch: openNextWorker.fetch,

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
