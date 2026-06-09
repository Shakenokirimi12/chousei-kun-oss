/**
 * Google OAuth トークンの保存時暗号化（AES-256-GCM）。
 *
 * 環境変数 `TOKEN_ENC_KEY`（32 バイトを base64 エンコードした文字列）が
 * 設定されている場合のみ暗号化を行う。未設定の場合は平文のまま保存する
 * （ローカル開発向けのフォールバック。本番では必ず設定すること）。
 *
 * 暗号化された値は `enc:v1:<ivBase64>:<ciphertextBase64>` 形式になる。
 * 復号時はこのプレフィックスの有無で暗号文と旧来の平文を判別するため、
 * 既存の平文トークンとの後方互換性がある。
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

    const raw = process.env.TOKEN_ENC_KEY;
    if (!raw) {
        cachedKey = null;
        return null;
    }

    const keyBytes = base64ToBytes(raw);
    if (keyBytes.length !== 32) {
        throw new Error("TOKEN_ENC_KEY must be 32 bytes (base64-encoded)");
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

/** 値を暗号化する。鍵が未設定なら平文をそのまま返す。null はそのまま通す。 */
export async function encryptToken(plaintext: string | null): Promise<string | null> {
    if (plaintext === null) return null;
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

/** 値を復号する。暗号化プレフィックスが無い場合は平文として扱いそのまま返す。 */
export async function decryptToken(stored: string | null): Promise<string | null> {
    if (stored === null) return null;
    if (!stored.startsWith(ENC_PREFIX)) return stored; // 旧来の平文

    const key = await getKey();
    if (!key) {
        throw new Error("Encrypted token found but TOKEN_ENC_KEY is not configured");
    }

    const [, , ivB64, ctB64] = stored.split(":");
    if (!ivB64 || !ctB64) throw new Error("Malformed encrypted token");
    const iv = base64ToBytes(ivB64);
    const ciphertext = base64ToBytes(ctB64);
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
    );
    return new TextDecoder().decode(plaintext);
}
