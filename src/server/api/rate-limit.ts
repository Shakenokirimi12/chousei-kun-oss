import type { Context } from "hono";

/**
 * Cloudflare Workers の Rate Limiting binding（`env.*: RateLimit`）の最小インターフェース。
 * グローバル型 `RateLimit` に依存せず、生成済みの型定義がなくてもコンパイルできるようにする。
 */
export interface RateLimitBinding {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * リクエスト元を識別するキー。Cloudflare 経由なら cf-connecting-ip が信頼できる。
 */
export function clientIp(c: Context): string {
    return (
        c.req.header("cf-connecting-ip") ||
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
    );
}

/**
 * レート制限を適用する。
 * - binding が未設定（`next dev` 等、バインディングが注入されない環境）の場合は許可（フェイルオープン）。
 * - limiter がエラーを返した場合も、可用性を優先してフェイルオープンしログに残す。
 *
 * @returns 許可なら true、超過なら false
 */
export async function enforceRateLimit(
    limiter: RateLimitBinding | undefined,
    key: string
): Promise<boolean> {
    if (!limiter) return true;
    try {
        const { success } = await limiter.limit({ key });
        return success;
    } catch (e) {
        console.error("[rate-limit]", e);
        return true;
    }
}
