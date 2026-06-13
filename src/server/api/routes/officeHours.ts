import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "@/server/db/client";
import { officeHours, officeHourBookings } from "@/server/db/schema";
import { createOfficeHourService } from "@/server/services/officeHour/officeHour.service";
import { generateSlots, isSlotBlockedByBusy, resolveDateRange, type WeeklyWindow } from "@/server/services/officeHour/slotGenerator";
import {
    createOfficeHourSchema,
    officeHourIdParamSchema,
    bookOfficeHourSchema,
    updateOfficeHourSchema,
} from "../schemas";
import { parseCookieValue, refreshGoogleTokenIfNeeded } from "../utils";
import { verifyPassword, createPasswordHash } from "@/lib/admin-auth";
import { COOKIE_NAMES } from "@/lib/constants";
import { syncOneOfficeHour } from "@/server/cron/sync-host-busy";
import { verifyOfficeHourAdminSession, isSameOrigin } from "../middleware";
import { safeJsonParse } from "@/lib/safe-json";
import { redactPii } from "@/lib/redact";
import { enforceRateLimit, clientIp, type RateLimitBinding } from "../rate-limit";

type Bindings = {
    DB: D1Database;
    AUTH_RATE_LIMITER?: RateLimitBinding;
    WRITE_RATE_LIMITER?: RateLimitBinding;
};

export const officeHoursRoutes = new Hono<{ Bindings: Bindings }>();

// CSRF: 状態変更系には Origin/Referer の同一オリジン検証を必須化。
officeHoursRoutes.use("*", async (c, next) => {
    const method = c.req.method;
    if (method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT") {
        if (!isSameOrigin(c)) {
            return c.json({ error: "Cross-origin request rejected" }, 403);
        }
    }
    return next();
});

/**
 * 自分が作成した Office Hour 一覧（Google セッション必須）。
 */
officeHoursRoutes.get("/mine", async (c) => {
    const db = createDb(c.env.DB);
    const cookieHeader = c.req.header("cookie") ?? "";
    const googleSessionId = parseCookieValue(cookieHeader, COOKIE_NAMES.GOOGLE_SESSION);
    if (!googleSessionId) {
        return c.json({ items: [], authenticated: false });
    }
    const session = await refreshGoogleTokenIfNeeded(db, googleSessionId);
    if (!session) {
        return c.json({ items: [], authenticated: false });
    }
    if (!session.userId) {
        return c.json({ items: [], authenticated: true, email: session.email, noUserId: true });
    }

    const svc = createOfficeHourService(db);
    const items = await svc.listByHostUser(session.userId);
    return c.json({ items, authenticated: true, email: session.email });
});

/**
 * 作成: 主催者は Google セッション必須。Campus 認証は body から受け取り、
 * サービス側で暗号化保存される。
 */
officeHoursRoutes.post("/", sValidator("json", createOfficeHourSchema), async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.DB);

    // Google セッション必須
    const cookieHeader = c.req.header("cookie") ?? "";
    const googleSessionId = parseCookieValue(cookieHeader, COOKIE_NAMES.GOOGLE_SESSION);
    if (!googleSessionId) {
        return c.json({ error: "Googleカレンダーの連携が必要です" }, 400);
    }
    const session = await refreshGoogleTokenIfNeeded(db, googleSessionId);
    if (!session) {
        return c.json({ error: "Googleセッションが無効です。再連携してください" }, 400);
    }
    if (!session.userId) {
        return c.json({ error: "ユーザー登録が完了していません。Googleアカウントを再連携してください。" }, 400);
    }

    const svc = createOfficeHourService(db);
    const { id, adminAccessToken } = await svc.create({
        title: body.title,
        description: body.description || undefined,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        windows: body.windows,
        slotDurationMin: body.slotDurationMin,
        capacityPerSlot: body.capacityPerSlot,
        bufferMin: body.bufferMin,
        adminPassword: body.adminPassword,
        hostUserId: session.userId,
        hostGoogleSessionId: googleSessionId,
        hostIcalUrl: body.icalUrl,
    });

    // 初回同期を実行（数秒かかるが、作成直後の画面で確実に反映させるため待機する）
    await syncOneOfficeHour(c.env, id);

    // 管理者セッション cookie をすぐ発行
    c.header(
        "Set-Cookie",
        `${COOKIE_NAMES.ADMIN_PREFIX}${id}=${adminAccessToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`
    );
    return c.json({ id }, 201);
});

/**
 * 公開ビュー: スロット一覧 + busy + 予約状況をまとめて返す。
 * 主催者の email や Campus 認証は返さない。
 */
officeHoursRoutes.get("/:id", sValidator("param", officeHourIdParamSchema), async (c) => {
    const db = createDb(c.env.DB);
    const svc = createOfficeHourService(db);
    const { id } = c.req.valid("param");
    let view = await svc.getPublicView(id);
    if (!view) {
        const deleted = await svc.isDeleted(id);
        if (deleted) return c.json({ error: "この Office Hour は削除されました", deleted: true }, 410);
        return c.json({ error: "Office Hour not found" }, 404);
    }

    if (view.lastSyncAt === null) {
        // まだ一度も同期されていない（Cron実行前など）場合は、オンデマンドで初回同期を実行
        await syncOneOfficeHour(c.env, id);
        view = (await svc.getPublicView(id))!;
    }

    const [busy, slotBookings] = await Promise.all([
        svc.getHostBusy(id),
        svc.getSlotBookings(id),
    ]);

    const { startDate, endDate } = resolveDateRange({
        startDate: view.startDate,
        endDate: view.endDate,
    });
    const slots = generateSlots({
        startDate,
        endDate,
        windows: view.windows as WeeklyWindow[],
        slotDurationMin: view.slotDurationMin,
        bufferMin: view.bufferMin,
    });

    // 各スロットの状態を組み立てる（過去・主催者の予定と重なるスロットは除外）
    const now = Date.now();
    const slotStates: {
        startMs: number;
        endMs: number;
        taken: number;
        remaining: number;
    }[] = [];
    for (const s of slots) {
        if (s.startMs < now) continue; // 過去のスロットは非表示
        if (isSlotBlockedByBusy(s, busy)) continue; // 予定が重なるスロットは非表示
        const taken = slotBookings.countBySlot.get(s.startMs) ?? 0;
        slotStates.push({
            startMs: s.startMs,
            endMs: s.endMs,
            taken,
            remaining: Math.max(0, view.capacityPerSlot - taken),
        });
    }

    return c.json({
        officeHour: {
            id: view.id,
            title: view.title,
            description: view.description,
            // null=「今日から / 無期限」を維持しつつ、resolve 後の表示範囲も併せて返す
            startDate: view.startDate,
            endDate: view.endDate,
            effectiveStartDate: startDate,
            effectiveEndDate: endDate,
            slotDurationMin: view.slotDurationMin,
            capacityPerSlot: view.capacityPerSlot,
            lastSyncAt: view.lastSyncAt,
        },
        slots: slotStates,
    });
});

/**
 * 予約。capacity + duplicate を service 内でチェック。
 */
officeHoursRoutes.post(
    "/:id/book",
    sValidator("param", officeHourIdParamSchema),
    sValidator("json", bookOfficeHourSchema),
    async (c) => {
        const { id } = c.req.valid("param");
        // 予約スパム対策（Office Hour + IP）。
        const allowed = await enforceRateLimit(c.env.WRITE_RATE_LIMITER, `book:${id}:${clientIp(c)}`);
        if (!allowed) {
            return c.json({ error: "予約の試行が多すぎます。しばらくしてから再度お試しください。" }, 429);
        }
        const db = createDb(c.env.DB);
        const svc = createOfficeHourService(db, c.env.DB);
        const body = c.req.valid("json");

        const oh = await svc.findById(id);
        if (!oh) return c.json({ error: "この Office Hour は削除されたか存在しません" }, 404);

        // 過去のスロットは予約不可
        if (body.slotStart < Date.now()) {
            return c.json({ error: "過去の枠は予約できません" }, 409);
        }
        // 受付終了日を超えたスロットは予約不可
        if (oh.endDate !== null && body.slotStart >= oh.endDate) {
            return c.json({ error: "受付期間を過ぎています" }, 409);
        }

        // 主催者の busy と重なっていないか再確認（クライアントが古い状態を持っている可能性に備える）
        const busy = await svc.getHostBusy(id);
        const slotEnd = body.slotStart + oh.slotDurationMin * 60_000;
        if (isSlotBlockedByBusy({ startMs: body.slotStart, endMs: slotEnd }, busy)) {
            return c.json({ error: "選択された枠は主催者の予定と重なっています" }, 409);
        }

        const r = await svc.book({
            officeHourId: id,
            slotStart: body.slotStart,
            name: body.name,
            comment: body.comment || undefined,
            email: body.email || undefined,
            userId: body.userId,
            capacityPerSlot: oh.capacityPerSlot,
        });
        if (!r.ok) {
            if (r.reason === "slot_full") return c.json({ error: "この枠は満員です" }, 409);
            if (r.reason === "duplicate") return c.json({ error: "既にこの枠を予約済みです" }, 409);
        }

        const bookingId = (r as { ok: true; bookingId: string }).bookingId;

        // Google カレンダー同期の結果をクライアントに返す。失敗しても予約自体は
        // 成立しているので、UI 側で「予約は完了したがカレンダーに反映できなかった」
        // と明示的に案内する。
        let calendarSync: "ok" | "failed" | "skipped" = "skipped";

        // Google カレンダーにイベントを自動作成（ホストのカレンダーに追加）
        try {
            const hostSession = await refreshGoogleTokenIfNeeded(db, oh.hostGoogleSessionId);
            if (hostSession?.accessToken) {
                const slotStartDate = new Date(body.slotStart);
                const slotEndDate = new Date(slotEnd);
                const startIso = toJstIso(slotStartDate);
                const endIso = toJstIso(slotEndDate);

                const attendees: { email: string; displayName?: string }[] = [];
                if (body.email) {
                    attendees.push({ email: body.email, displayName: body.name });
                }

                const description = [
                    `予約者: ${body.name}`,
                    body.email ? `メール: ${body.email}` : null,
                    body.comment ? `コメント: ${body.comment}` : null,
                    `\n調整くん Office Hour で自動作成されました。`,
                ].filter(Boolean).join("\n");

                const calRes = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events${attendees.length > 0 ? "?sendUpdates=all" : ""}`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${hostSession.accessToken}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            summary: `${oh.title} - ${body.name}`,
                            description,
                            start: { dateTime: startIso, timeZone: "Asia/Tokyo" },
                            end: { dateTime: endIso, timeZone: "Asia/Tokyo" },
                            attendees,
                        }),
                        signal: AbortSignal.timeout(10_000),
                    }
                );

                if (calRes.ok) {
                    const calEvent = await calRes.json() as { id?: string };
                    if (calEvent.id) {
                        await db
                            .update(officeHourBookings)
                            .set({ googleCalendarEventId: calEvent.id })
                            .where(eq(officeHourBookings.id, bookingId));
                    }
                    calendarSync = "ok";
                } else {
                    const errBody = await calRes.text().catch(() => "");
                    console.error("[office-hour/book] Google Calendar event creation failed:", calRes.status, redactPii(errBody));
                    calendarSync = "failed";
                }
            }
        } catch (e) {
            console.error("[office-hour/book] Failed to create Google Calendar event:", redactPii(e));
            calendarSync = "failed";
        }

        return c.json({ ok: true, bookingId, calendarSync });
    }
);

/** 管理者ログイン（既存の admin-auth と同じ動作）。 */
officeHoursRoutes.post(
    "/:id/admin-auth",
    sValidator("param", officeHourIdParamSchema),
    sValidator("json", z.object({ password: z.string().min(1).max(256) })),
    async (c) => {
        const { id } = c.req.valid("param");
        // パスワード総当たり対策（Office Hour + IP 単位）。events 側と揃える。
        const allowed = await enforceRateLimit(c.env.AUTH_RATE_LIMITER, `oh-auth:${id}:${clientIp(c)}`);
        if (!allowed) {
            return c.json({ error: "試行回数が多すぎます。しばらくしてから再度お試しください。" }, 429);
        }
        const db = createDb(c.env.DB);
        const { password } = c.req.valid("json");
        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: { adminPasswordHash: true, adminAccessToken: true },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        const result = await verifyPassword(password, row.adminPasswordHash);
        if (!result.ok) return c.json({ error: "Invalid password" }, 401);
        if (result.needsRehash) {
            try {
                const upgraded = await createPasswordHash(password);
                await db.update(officeHours).set({ adminPasswordHash: upgraded }).where(eq(officeHours.id, id));
            } catch (e) {
                console.error("[oh admin-auth] hash upgrade failed:", e);
            }
        }
        c.header(
            "Set-Cookie",
            `${COOKIE_NAMES.ADMIN_PREFIX}${id}=${row.adminAccessToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`
        );
        return c.json({ ok: true });
    }
);

/** 管理者: Office Hour を論理削除。 */
officeHoursRoutes.delete(
    "/:id",
    sValidator("param", officeHourIdParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyOfficeHourAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);
        if (auth.deleted) return c.json({ error: "既に削除されています" }, 410);
        const svc = createOfficeHourService(db);
        await svc.softDelete(id);
        return c.json({ ok: true });
    }
);

/** 管理者: 予約一覧（既存パターンと同様、admin cookie 必須）。 */
officeHoursRoutes.get(
    "/:id/admin/bookings",
    sValidator("param", officeHourIdParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyOfficeHourAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);

        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: { title: true },
        });
        const svc = createOfficeHourService(db);
        const bookings = await svc.listBookingsForAdmin(id);
        return c.json({ title: row?.title ?? "", bookings, deleted: auth.deleted ?? false });
    }
);

/** 管理者: Office Hour の設定取得。 */
officeHoursRoutes.get(
    "/:id/admin/settings",
    sValidator("param", officeHourIdParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyOfficeHourAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);

        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: {
                title: true,
                description: true,
                startDate: true,
                endDate: true,
                windows: true,
                slotDurationMin: true,
                capacityPerSlot: true,
                bufferMin: true,
            },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        return c.json({
            title: row.title,
            description: row.description,
            startDate: row.startDate,
            endDate: row.endDate,
            windows: safeJsonParse<WeeklyWindow[]>(row.windows, "office_hours.windows") ?? [],
            slotDurationMin: row.slotDurationMin,
            capacityPerSlot: row.capacityPerSlot,
            bufferMin: row.bufferMin,
            deleted: auth.deleted ?? false,
        });
    }
);

/** 管理者: Office Hour の時間枠を更新。 */
officeHoursRoutes.patch(
    "/:id",
    sValidator("param", officeHourIdParamSchema),
    sValidator("json", updateOfficeHourSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const body = c.req.valid("json");
        const auth = await verifyOfficeHourAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);
        if (auth.deleted) return c.json({ error: "この Office Hour は削除されています" }, 410);
        const svc = createOfficeHourService(db);
        await svc.updateSettings(id, body);
        return c.json({ ok: true });
    }
);

function toJstIso(date: Date): string {
    const jst = new Date(date.getTime() + 9 * 60 * 60_000);
    const y = jst.getUTCFullYear();
    const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(jst.getUTCDate()).padStart(2, "0");
    const h = String(jst.getUTCHours()).padStart(2, "0");
    const mi = String(jst.getUTCMinutes()).padStart(2, "0");
    const s = String(jst.getUTCSeconds()).padStart(2, "0");
    return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}
