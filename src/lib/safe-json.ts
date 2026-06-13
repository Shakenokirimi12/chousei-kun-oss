/**
 * DB に保存されている文字列を JSON.parse する際の安全なラッパー。
 * 破損データに対して例外を投げず、null を返してログに残す。
 */
export function safeJsonParse<T = unknown>(raw: string | null | undefined, context: string): T | null {
    if (raw == null) return null;
    try {
        return JSON.parse(raw) as T;
    } catch (e) {
        console.error(`[safeJsonParse] Failed to parse JSON for ${context}:`, e);
        return null;
    }
}
