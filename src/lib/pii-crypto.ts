/**
 * 参加者・予約者の PII（name / email / comment 等）の保存時暗号化（AES-256-GCM）。
 *
 * 仕様は token-crypto と同じ：
 * - 環境変数 `PII_ENC_KEY`（32 バイトを base64 で表した文字列）が設定されている場合のみ暗号化。
 * - 暗号文は `enc:v1:<ivBase64>:<ctBase64>` 形式。
 * - 復号時はプレフィックスの有無で旧来の平文と判別するため後方互換性がある。
 *
 * 鍵を token-crypto と分離する理由：
 * - 万一片方の鍵が漏れたとき他方の被害を局所化できる。
 * - 互換性のため、`PII_ENC_KEY` 未設定時は `TOKEN_ENC_KEY` を流用してフォールバック
 *   する（既存デプロイで運用を切らさないため）。
 */

const ENC_PREFIX = "enc:v1:";
let cachedKey: CryptoKey | null | undefined;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function getKey(): Promise<CryptoKey | null> {
    if (cachedKey !== undefined) return cachedKey;

    const raw = process.env.PII_ENC_KEY || process.env.TOKEN_ENC_KEY;
    if (!raw) {
        if (process.env.NODE_ENV === "production") {
            // 本番では平文保存にフォールバックさせない。デプロイ設定ミスは早期に検出。
            throw new Error("PII_ENC_KEY (or TOKEN_ENC_KEY) must be set in production");
        }
        cachedKey = null;
        return null;
    }

    const keyBytes = base64ToBytes(raw);
    if (keyBytes.length !== 32) {
        throw new Error("PII_ENC_KEY must be 32 bytes (base64-encoded)");
    }
    cachedKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
    return cachedKey;
}

/** 既に暗号化済み(プレフィックスあり)か判定。 */
export function isEncryptedPii(value: string | null | undefined): boolean {
    return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/** 値を暗号化する。鍵が未設定なら平文をそのまま返す。null/undefined はそのまま通す。 */
export async function encryptPii(plaintext: string | null | undefined): Promise<string | null> {
    if (plaintext == null) return null;
    if (isEncryptedPii(plaintext)) return plaintext; // 二重暗号化防止
    const key = await getKey();
    if (!key) return plaintext;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(plaintext)
    );
    return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/** 値を復号する。暗号化プレフィックスが無い場合は旧来の平文として扱いそのまま返す。 */
export async function decryptPii(stored: string | null | undefined): Promise<string | null> {
    if (stored == null) return null;
    if (!stored.startsWith(ENC_PREFIX)) return stored; // 旧来の平文

    const key = await getKey();
    if (!key) {
        throw new Error("Encrypted PII found but PII_ENC_KEY is not configured");
    }

    const [, , ivB64, ctB64] = stored.split(":");
    if (!ivB64 || !ctB64) throw new Error("Malformed encrypted PII");
    const iv = base64ToBytes(ivB64);
    const ciphertext = base64ToBytes(ctB64);
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
    );
    return new TextDecoder().decode(plaintext);
}
