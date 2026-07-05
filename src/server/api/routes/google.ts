import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { eq } from "drizzle-orm";
import { createDb } from "@/server/db/client";
import { googleOauthSessions } from "@/server/db/schema";
import { googleStartQuerySchema } from "../schemas";
import {
    getEnvOrThrow,
    encodeState,
    decodeState,
    parseCookieValue,
    cookieSecurityAttr,
    refreshGoogleTokenIfNeeded,
    getGoogleSessionAndScopes,
    resolveGoogleScopes,
    GOOGLE_CALENDAR_READ_SCOPE,
    GOOGLE_CALENDAR_WRITE_SCOPE,
} from "../utils";
import { encryptToken } from "@/lib/token-crypto";
import { createUserService } from "@/server/services/user.service";

type Bindings = {
    DB: D1Database;
};

export const googleRoutes = new Hono<{ Bindings: Bindings }>();

googleRoutes.get("/auth/start", sValidator("query", googleStartQuerySchema), async (c) => {
    const clientId = getEnvOrThrow("GOOGLE_CLIENT_ID");
    const redirectUri = getEnvOrThrow("GOOGLE_REDIRECT_URI");
    const { returnTo, userId, scope } = c.req.valid("query");
    const nonce = crypto.randomUUID();
    const state = encodeState({ nonce, returnTo, userId });

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", resolveGoogleScopes(scope));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    // インクリメンタル認可: 以前の認可で得た他スコープの付与状態を保持したまま
    // 今回のスコープを追加要求する（Google 推奨のインクリメンタル認可パターン）。
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("state", state);

    const secureAttr = cookieSecurityAttr(c.req.url);
    c.header("Set-Cookie", `chousei_google_oauth_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=600`);
    return c.redirect(authUrl.toString(), 302);
});

googleRoutes.get("/auth/callback", async (c) => {
    const clientId = getEnvOrThrow("GOOGLE_CLIENT_ID");
    const clientSecret = getEnvOrThrow("GOOGLE_CLIENT_SECRET");
    const redirectUri = getEnvOrThrow("GOOGLE_REDIRECT_URI");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.json({ error: "Invalid OAuth callback" }, 400);

    const cookieHeader = c.req.header("cookie") ?? "";
    const nonceFromCookie = parseCookieValue(cookieHeader, "chousei_google_oauth_nonce");
    const decoded = decodeState<{ nonce: string; returnTo?: string; userId?: string }>(state);
    if (!nonceFromCookie || decoded.nonce !== nonceFromCookie) {
        return c.json({ error: "Invalid OAuth state" }, 400);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return c.json({ error: "Failed to exchange token" }, 500);
    const tokenJson = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        id_token?: string;
    };

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (!userInfoRes.ok) return c.json({ error: "Failed to fetch user info" }, 500);
    const userInfo = await userInfoRes.json() as { email: string };

    const db = createDb(c.env.DB);
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = Math.floor(now / 1000) + tokenJson.expires_in;

    // userId が state 経由で来ていればそのユーザーを getOrCreate
    let resolvedUserId: string | null = null;
    if (decoded.userId) {
        const userService = createUserService(db);
        const user = await userService.getOrCreate(decoded.userId);
        resolvedUserId = user.id;
    }

    await db.insert(googleOauthSessions).values({
        sessionId,
        userId: resolvedUserId,
        email: userInfo.email,
        accessToken: (await encryptToken(tokenJson.access_token))!,
        refreshToken: await encryptToken(tokenJson.refresh_token ?? null),
        expiresAt,
        createdAt: now,
        updatedAt: now,
    });

    // オープンリダイレクト対策: 単一スラッシュ始まりの相対パスのみ許可
    // （`//evil.com` や `/\evil.com` のようなプロトコル相対 URL を拒否）
    const isSafeReturnTo =
        typeof decoded.returnTo === "string" &&
        decoded.returnTo.startsWith("/") &&
        !decoded.returnTo.startsWith("//") &&
        !decoded.returnTo.startsWith("/\\");
    const redirectTo = isSafeReturnTo ? decoded.returnTo! : "/";
    const secureAttr = cookieSecurityAttr(c.req.url);
    c.header(
        "Set-Cookie",
        `chousei_google_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=2592000`,
        { append: true }
    );
    c.header(
        "Set-Cookie",
        `chousei_google_oauth_nonce=; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=0`,
        { append: true }
    );
    return c.redirect(redirectTo, 302);
});

googleRoutes.get("/calendar/events", async (c) => {
    const cookieHeader = c.req.header("cookie") ?? "";
    const sessionId = parseCookieValue(cookieHeader, "chousei_google_session");
    if (!sessionId) return c.json({ error: "Google session not found" }, 401);

    const db = createDb(c.env.DB);
    const session = await refreshGoogleTokenIfNeeded(db, sessionId);
    if (!session) return c.json({ error: "Google session not found" }, 401);

    // maxResults=250 は calendarList.list の上限値。ほぼ全ユーザーを1ページで賄える。
    const calendarListRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (!calendarListRes.ok) return c.json({ error: "Failed to fetch calendar list" }, 500);
    const calendarList = await calendarListRes.json() as {
        items?: Array<{ id: string; primary?: boolean; selected?: boolean; deleted?: boolean }>;
    };

    /**
     * カレンダー数が多いユーザー（バイト先など複数の共有/購読カレンダーを持つ場合）でも
     * 重要なカレンダーが取得枠から漏れないよう、優先順位をつけてから上限を適用する:
     *   1. プライマリカレンダー
     *   2. Google カレンダーの一覧でチェックが入っている（selected）カレンダー
     *      — 共有されて「追加」した外部カレンダー（バイト先の予定など）は通常ここに入る
     *   3. それ以外（購読はしているが表示を外しているものなど）
     * 削除済み（deleted）カレンダーは除外する。
     * 以前は Google の返却順のまま先頭10件で打ち切っており、優先度に関係なく
     * 11件目以降のカレンダー（バイト先の共有カレンダー等）が読めなくなる不具合があった。
     */
    const MAX_CALENDARS = 25;
    const rank = (cal: { primary?: boolean; selected?: boolean }) =>
        cal.primary ? 0 : cal.selected ? 1 : 2;
    const calendarIds = (calendarList.items ?? [])
        .filter((cal) => !cal.deleted)
        .sort((a, b) => rank(a) - rank(b))
        .map((cal) => cal.id)
        .slice(0, MAX_CALENDARS);

    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 1000 * 60 * 60 * 24 * 120).toISOString();
    const eventsByCalendar = await Promise.all(
        calendarIds.map(async (calendarId) => {
            const evRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250`,
                { headers: { Authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(10_000) }
            );
            if (!evRes.ok) return [];
            const evJson = await evRes.json() as {
                items?: Array<{
                    summary?: string;
                    description?: string;
                    htmlLink?: string;
                    start?: { dateTime?: string; date?: string };
                    end?: { dateTime?: string; date?: string };
                    source?: { url?: string };
                }>;
            };
            return (evJson.items ?? []).map((item) => ({
                summary: item.summary ?? "",
                description: item.description ?? "",
                htmlLink: item.htmlLink ?? "",
                calendarId,
                sourceUrl: item.source?.url ?? "",
                dtstart: item.start?.dateTime ?? item.start?.date ?? "",
                dtend: item.end?.dateTime ?? item.end?.date ?? "",
                allDay: !!item.start?.date && !item.start?.dateTime,
            }));
        })
    );

    return c.json({ email: session.email, events: eventsByCalendar.flat() });
});

googleRoutes.get("/session-status", async (c) => {
    const cookieHeader = c.req.header("cookie") ?? "";
    const sessionId = parseCookieValue(cookieHeader, "chousei_google_session");
    if (!sessionId) {
        return c.json({
            hasSession: false,
            email: null,
            hasCalendarReadScope: false,
            hasCalendarWriteScope: false,
            hasUserId: false,
        });
    }

    const db = createDb(c.env.DB);
    const { session, scopes } = await getGoogleSessionAndScopes(db, sessionId);
    if (!session) {
        return c.json({
            hasSession: false,
            email: null,
            hasCalendarReadScope: false,
            hasCalendarWriteScope: false,
            hasUserId: false,
        });
    }

    return c.json({
        hasSession: true,
        email: session.email,
        hasCalendarReadScope: scopes.includes(GOOGLE_CALENDAR_READ_SCOPE),
        hasCalendarWriteScope: scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE),
        hasUserId: !!session.userId,
    });
});

googleRoutes.post("/logout", async (c) => {
    const cookieHeader = c.req.header("cookie") ?? "";
    const sessionId = parseCookieValue(cookieHeader, "chousei_google_session");
    if (sessionId) {
        const db = createDb(c.env.DB);
        await db.delete(googleOauthSessions).where(eq(googleOauthSessions.sessionId, sessionId));
    }
    const secureAttr = cookieSecurityAttr(c.req.url);
    c.header("Set-Cookie", `chousei_google_session=; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=0`);
    return c.json({ ok: true });
});
