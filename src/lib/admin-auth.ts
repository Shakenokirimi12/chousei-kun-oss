const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
    const payload = `${salt}:${password}`;
    const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(payload));
    return toHex(digest);
}

export async function createPasswordHash(password: string): Promise<string> {
    const salt = crypto.randomUUID();
    const hash = await hashPassword(password, salt);
    return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
    if (!storedHash) return false;
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) return false;
    const candidate = await hashPassword(password, salt);
    return candidate === hash;
}
