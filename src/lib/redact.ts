/**
 * 外部API（Google Calendar 等）のエラーレスポンスをそのままログ出力すると
 * 出席者メール等の PII が漏れる可能性がある。最小限の情報だけ残し、
 * email/誌字列のような長いトークン状文字列を伏字化する。
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_TOKEN_RE = /[A-Za-z0-9_\-]{32,}/g;

export function redactPii(input: unknown, maxLen = 800): string {
    let s: string;
    if (input == null) return "";
    if (typeof input === "string") s = input;
    else if (input instanceof Error) s = input.message;
    else {
        try { s = JSON.stringify(input); } catch { s = String(input); }
    }
    s = s
        .replace(EMAIL_RE, "[email-redacted]")
        .replace(LONG_TOKEN_RE, "[token-redacted]");
    if (s.length > maxLen) s = s.slice(0, maxLen) + "…[truncated]";
    return s;
}
