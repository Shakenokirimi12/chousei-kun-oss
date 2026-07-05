import { eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import { googleOauthSessions } from "@/server/db/schema";
import { CUSTOM_PERIODS } from "@/config/periods";
import type { CandidateWindow } from "@/types";
import { nextDateString } from "@/lib/candidates";
import { encryptToken, decryptToken } from "@/lib/token-crypto";

export const GOOGLE_CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * OAuth の最小権限の原則(インクリメンタル認可)に沿って、用途別にスコープ段階を分ける。
 * 以前は全フローで read+write を一律要求しており、Google の審査で
 * 「最小スコープのリクエスト」指摘（用途に対してスコープが広すぎる）を受けた。
 *
 * - basic: 本人確認・通知先メール取得のみ（カレンダーへの読み書きは一切しない）
 *   例: 参加者が「Googleカレンダーに自動追加」を選ぶ際のメールアドレス確認
 * - read : 自分の予定を読み取り、候補日程との重複プレビューに使う
 *   例: イベント作成時/回答時の「自分の予定から取り込む」
 * - write: Google カレンダーへの予定作成・招待送信に使う（read を含む）
 *   例: 管理者が確定日程を Google カレンダーに追加して参加者に招待を送る
 */
export const GOOGLE_SCOPE_TIERS = {
    basic: ["openid", "email"],
    read: ["openid", "email", GOOGLE_CALENDAR_READ_SCOPE],
    write: ["openid", "email", GOOGLE_CALENDAR_READ_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE],
} as const;

export type GoogleScopeTier = keyof typeof GOOGLE_SCOPE_TIERS;

export function resolveGoogleScopes(tier: GoogleScopeTier): string {
    return GOOGLE_SCOPE_TIERS[tier].join(" ");
}

export function getEnvOrThrow(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
}

export function encodeState(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeState<T>(state: string): T {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as T;
}

export function parseCookieValue(cookieHeader: string, key: string): string | undefined {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
    return match?.[1];
}

export function cookieSecurityAttr(requestUrl: string): string {
    const isHttps = requestUrl.startsWith("https://");
    return isHttps ? "; Secure" : "";
}

export function formatJstDateTime(datePart: string, hhmm: string): string {
    const [hourRaw, minuteRaw] = hhmm.split(":");
    const hour = String(Number(hourRaw)).padStart(2, "0");
    const minute = String(Number(minuteRaw)).padStart(2, "0");
    return `${datePart}T${hour}:${minute}:00+09:00`;
}

export function parseCandidateWindow(candidate: string): CandidateWindow | null {
    const [datePart, slotRaw] = candidate.split("_");
    if (!datePart || !slotRaw) return null;

    const slotType = slotRaw.charAt(0);

    if (slotType === "D") {
        return {
            allDay: true,
            startDate: datePart,
            endDateExclusive: nextDateString(datePart),
        };
    }

    const slotId = Number.parseInt(slotRaw.slice(1), 10);
    if (Number.isNaN(slotId)) return null;

    if (slotType === "P") {
        const period = CUSTOM_PERIODS.find((p) => p.id === slotId);
        if (!period) return null;
        const [startHm, endHm] = period.time.split("-");
        return {
            startDateTime: formatJstDateTime(datePart, startHm),
            endDateTime: formatJstDateTime(datePart, endHm),
        };
    }

    if (slotType === "H") {
        const startHour = Math.max(0, Math.min(23, slotId));
        const endHour = Math.min(24, startHour + 1);
        const startHm = `${String(startHour).padStart(2, "0")}:00`;
        const endHm = `${String(endHour).padStart(2, "0")}:00`;
        return {
            startDateTime: formatJstDateTime(datePart, startHm),
            endDateTime: formatJstDateTime(datePart, endHm),
        };
    }

    return null;
}

/**
 * セッションを取得し、必要ならアクセストークンをリフレッシュする。
 * 戻り値の accessToken / refreshToken は復号済み（平文）。
 */
export async function refreshGoogleTokenIfNeeded(db: DbClient, sessionId: string) {
    const record = await db.query.googleOauthSessions.findFirst({
        where: eq(googleOauthSessions.sessionId, sessionId),
    });
    if (!record) return null;

    const refreshToken = await decryptToken(record.refreshToken);
    const decryptedRecord = {
        ...record,
        accessToken: (await decryptToken(record.accessToken))!,
        refreshToken,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (decryptedRecord.expiresAt > nowSec + 60) return decryptedRecord;
    if (!refreshToken) return decryptedRecord;

    const clientId = getEnvOrThrow("GOOGLE_CLIENT_ID");
    const clientSecret = getEnvOrThrow("GOOGLE_CLIENT_SECRET");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return decryptedRecord;
    const tokenJson = await tokenRes.json() as { access_token: string; expires_in: number };
    const updatedExpiresAt = Math.floor(Date.now() / 1000) + tokenJson.expires_in;
    await db
        .update(googleOauthSessions)
        .set({
            accessToken: (await encryptToken(tokenJson.access_token))!,
            expiresAt: updatedExpiresAt,
            updatedAt: Date.now(),
        })
        .where(eq(googleOauthSessions.sessionId, sessionId));

    return {
        ...decryptedRecord,
        accessToken: tokenJson.access_token,
        expiresAt: updatedExpiresAt,
    };
}

export async function getGoogleSessionAndScopes(db: DbClient, sessionId: string) {
    const session = await refreshGoogleTokenIfNeeded(db, sessionId);
    if (!session) {
        return { session: null, scopes: [] as string[] };
    }

    // access_token を URL クエリに載せると Referer/ログに残るため、
    // Authorization ヘッダ経由で問い合わせる。
    const tokenInfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/tokeninfo",
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ access_token: session.accessToken }),
            signal: AbortSignal.timeout(10_000),
        }
    );
    if (!tokenInfoRes.ok) {
        return { session, scopes: [] as string[] };
    }

    const tokenInfo = await tokenInfoRes.json() as { scope?: string };
    const scopes = tokenInfo.scope?.split(" ").filter(Boolean) ?? [];
    return { session, scopes };
}
