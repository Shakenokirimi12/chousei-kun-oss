import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { createDb } from "@/server/db/client";
import { events, officeHours } from "@/server/db/schema";
import { COOKIE_NAMES, API_ERRORS } from "@/lib/constants";
import { timingSafeEqual } from "@/lib/admin-auth";

type Bindings = {
    DB: D1Database;
};

export async function verifyAdminSession(
    c: Context<{ Bindings: Bindings }>,
    eventId: string
): Promise<{ authorized: boolean; error?: string }> {
    const cookie = c.req.header("cookie") ?? "";
    const tokenMatch = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAMES.ADMIN_PREFIX}${eventId}=([^;]+)`));
    const sessionToken = tokenMatch?.[1];

    if (!sessionToken) {
        return { authorized: false, error: API_ERRORS.UNAUTHORIZED };
    }

    const db = createDb(c.env.DB);
    const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
            adminAccessToken: true,
        },
    });

    if (!event?.adminAccessToken || !timingSafeEqual(sessionToken, event.adminAccessToken)) {
        return { authorized: false, error: API_ERRORS.UNAUTHORIZED };
    }

    return { authorized: true };
}

/**
 * Office Hour 用の管理者セッション検証。Cookie のトークンを timing-safe で
 * DB の adminAccessToken と比較する。
 *
 * 戻り値の `officeHour` は呼び出し側が更に列を必要としないようにする最小情報のみ。
 * 追加列が要るならルート側で改めて findFirst する。
 */
export async function verifyOfficeHourAdminSession(
    c: Context<{ Bindings: Bindings }>,
    officeHourId: string
): Promise<{ authorized: boolean; error?: string; deleted?: boolean }> {
    const cookie = c.req.header("cookie") ?? "";
    const tokenMatch = cookie.match(
        new RegExp(`(?:^|;\\s*)${COOKIE_NAMES.ADMIN_PREFIX}${officeHourId}=([^;]+)`)
    );
    const sessionToken = tokenMatch?.[1];
    if (!sessionToken) {
        return { authorized: false, error: API_ERRORS.UNAUTHORIZED };
    }

    const db = createDb(c.env.DB);
    const row = await db.query.officeHours.findFirst({
        where: eq(officeHours.id, officeHourId),
        columns: { adminAccessToken: true, deletedAt: true },
    });
    if (!row) {
        return { authorized: false, error: "Office Hour not found" };
    }
    if (!timingSafeEqual(sessionToken, row.adminAccessToken)) {
        return { authorized: false, error: API_ERRORS.UNAUTHORIZED };
    }

    return { authorized: true, deleted: row.deletedAt !== null };
}

export function createCookieHeader(
    name: string,
    value: string,
    options: {
        maxAge?: number;
        path?: string;
        httpOnly?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
        secure?: boolean;
    } = {}
): string {
    const {
        maxAge,
        path = "/",
        httpOnly = true,
        sameSite = "Lax",
        secure = true,
    } = options;

    let header = `${name}=${value}; Path=${path}; SameSite=${sameSite}`;
    
    if (httpOnly) header += "; HttpOnly";
    if (secure) header += "; Secure";
    if (maxAge !== undefined) header += `; Max-Age=${maxAge}`;

    return header;
}

export function clearCookieHeader(name: string, path = "/"): string {
    return createCookieHeader(name, "", { maxAge: 0, path });
}

/**
 * CSRF 防御。状態変更系（POST/PATCH/DELETE）でリクエスト元のスキーム+ホストが
 * 自身と一致しない場合に拒否する。SameSite=Lax cookie と併用して二重防御。
 *
 * - Origin ヘッダがあればそれを優先。
 * - 無い場合 Referer ヘッダのスキーム+ホスト部を見る。
 * - どちらも無い場合は古いユーザーエージェント等の可能性があるため許可
 *   （API クライアントを完全に締め出すほどの厳格化はしない）。
 */
export function isSameOrigin(c: Context): boolean {
    const reqUrl = new URL(c.req.url);
    const selfOrigin = `${reqUrl.protocol}//${reqUrl.host}`;

    const origin = c.req.header("origin");
    if (origin) return origin === selfOrigin;

    const referer = c.req.header("referer");
    if (referer) {
        try {
            const refUrl = new URL(referer);
            return `${refUrl.protocol}//${refUrl.host}` === selfOrigin;
        } catch {
            return false;
        }
    }
    return true; // ヘッダ無し: 許可
}
