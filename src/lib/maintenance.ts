/**
 * メンテナンスモード。
 *
 * Cloudflare Flagship のブール型フラグ `maintenance-mode` を評価し、ON の間は
 * 全リクエストをメンテナンス応答に差し替える（middleware.ts から使用）。
 * フラグはダッシュボード/REST API から再デプロイ無しで即時 ON/OFF できる。
 */

/** Flagship 上のフラグキー。ダッシュボードで作成するキーと一致させること。 */
export const MAINTENANCE_FLAG_KEY = "maintenance-mode";

/** 503 応答に付ける Retry-After（秒）。クローラ等への目安。 */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 600;

/**
 * Flagship バインディングのうち本機能で使う部分だけの最小型。
 * `@cloudflare/workers-types` の `Flagship` 型生成に依存しないよう自前定義する。
 */
interface FlagsBinding {
    getBooleanValue(
        flagKey: string,
        defaultValue: boolean,
        context?: Record<string, string | number | boolean>
    ): Promise<boolean>;
}

/**
 * メンテナンスモードが有効かを判定する。
 * バインディング未設定・評価失敗時は false（=通常稼働）へフェイルオープンする。
 * 「フラグ基盤が落ちたらサイト全体が止まる」事故を避けるための既定。
 */
export async function isMaintenanceMode(env: unknown): Promise<boolean> {
    const flags = (env as { FLAGS?: FlagsBinding } | undefined)?.FLAGS;
    if (!flags) return false;
    try {
        return await flags.getBooleanValue(MAINTENANCE_FLAG_KEY, false);
    } catch {
        return false;
    }
}

/** API 向けメンテナンス応答の JSON ボディ。 */
export const MAINTENANCE_JSON_BODY = {
    error: "ただいまメンテナンス中です。しばらくしてから再度お試しください。",
} as const;

/** ページ向けメンテナンス HTML（自己完結・インライン CSS。アプリ資産に依存しない）。 */
export function maintenanceHtml(): string {
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>メンテナンス中 - 調整くん</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: #f7f7f8; color: #1f2328;
  }
  .card {
    width: 100%; max-width: 480px; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px;
    padding: 40px 32px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }
  .icon { font-size: 44px; line-height: 1; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.7; margin: 0; color: #57606a; }
  .brand { margin-top: 28px; font-size: 12px; color: #8b949e; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    .card { background: #161b22; border-color: #30363d; box-shadow: none; }
    p { color: #9da7b3; }
    .brand { color: #6e7681; }
  }
</style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">🛠️</div>
    <h1>ただいまメンテナンス中です</h1>
    <p>システムメンテナンスのため、一時的にご利用いただけません。<br>
       お手数ですが、しばらくしてから再度アクセスしてください。</p>
    <div class="brand">調整くん</div>
  </main>
</body>
</html>`;
}
