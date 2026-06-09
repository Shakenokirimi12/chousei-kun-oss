/**
 * ユーザー提供 URL を取得する際の SSRF 対策付き fetch。
 *
 * - https のみ許可
 * - localhost / プライベート IP / クラウドメタデータ IP をブロック
 * - リダイレクトは手動で追跡し、各ホップを再検証（最大 3 回）
 * - タイムアウトとレスポンスサイズ上限を強制
 *
 * 注意: DNS リバインディング（ホスト名→プライベート IP）は Worker 環境では
 * 完全には防げないが、Cloudflare のエッジからは RFC1918 等へ到達できないため
 * リスクは限定的。リテラル IP とよく知られたホスト名はここでブロックする。
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REDIRECTS = 3;

function isBlockedIpv4(host: string): boolean {
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
}

function isBlockedHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    if (host === "::1" || host === "::") return true; // IPv6 loopback / unspecified
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // IPv6 ULA fc00::/7
    if (host.startsWith("fe80")) return true; // IPv6 link-local
    if (host.startsWith("::ffff:")) return true; // IPv4-mapped IPv6
    if (isBlockedIpv4(host)) return true;
    return false;
}

function assertSafeUrl(rawUrl: string): URL {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error("Invalid URL");
    }
    if (url.protocol !== "https:") {
        throw new Error("Only https URLs are allowed");
    }
    if (isBlockedHost(url.hostname)) {
        throw new Error("URL host is not allowed");
    }
    return url;
}

/**
 * SSRF 対策付きで外部 URL を取得し、テキストを返す。
 */
export async function safeFetchText(
    rawUrl: string,
    opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

    let current = assertSafeUrl(rawUrl).toString();

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await fetch(current, {
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
            headers: { Accept: "text/calendar, text/plain, */*" },
        });

        // リダイレクトは手動で再検証
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) throw new Error("Redirect without Location header");
            current = assertSafeUrl(new URL(location, current).toString()).toString();
            continue;
        }

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        // サイズ上限の事前チェック
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > maxBytes) {
            throw new Error("Response too large");
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes) {
            throw new Error("Response too large");
        }
        return new TextDecoder().decode(buffer);
    }

    throw new Error("Too many redirects");
}
