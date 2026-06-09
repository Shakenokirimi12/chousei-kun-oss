const textEncoder = new TextEncoder();

/** PBKDF2 iteration count for new password hashes. */
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN_BITS = 256;

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * 長さリークを避けるための定数時間文字列比較。
 * 長さが異なる場合は false。
 */
export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}

/** 旧形式: ソルト付き単一ラウンド SHA-256（後方互換のためのみ残す）。 */
async function legacySha256(password: string, salt: string): Promise<string> {
    const payload = `${salt}:${password}`;
    const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(payload));
    return toHex(digest);
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
    const salt = Uint8Array.from(
        saltHex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []
    );
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations },
        keyMaterial,
        PBKDF2_KEYLEN_BITS
    );
    return toHex(bits);
}

/**
 * 新しいパスワードハッシュを生成する。
 * 形式: `pbkdf2$<iterations>$<saltHex>$<hashHex>`
 */
export async function createPasswordHash(password: string): Promise<string> {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = toHex(saltBytes.buffer);
    const hash = await pbkdf2(password, saltHex, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hash}`;
}

/**
 * パスワードを検証する。新形式(pbkdf2$...)と旧形式(salt:hash)の両方をサポート。
 * 比較は定数時間で行う。
 */
export async function verifyPassword(
    password: string,
    storedHash: string | null | undefined
): Promise<boolean> {
    if (!storedHash) return false;

    if (storedHash.startsWith("pbkdf2$")) {
        const [, iterationsRaw, saltHex, hash] = storedHash.split("$");
        const iterations = Number.parseInt(iterationsRaw, 10);
        if (!saltHex || !hash || !Number.isFinite(iterations)) return false;
        const candidate = await pbkdf2(password, saltHex, iterations);
        return timingSafeEqual(candidate, hash);
    }

    // 旧形式: salt:hash（単一ラウンド SHA-256）
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) return false;
    const candidate = await legacySha256(password, salt);
    return timingSafeEqual(candidate, hash);
}
