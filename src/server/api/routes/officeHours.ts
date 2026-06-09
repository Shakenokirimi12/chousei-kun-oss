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
import { verifyPassword } from "@/lib/admin-auth";
import { COOKIE_NAMES } from "@/lib/constants";

type Bindings = { DB: D1Database };

export const officeHoursRoutes = new Hono<{ Bindings: Bindings }>();

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

    // 管理者セッション cookie をすぐ発行
    c.header(
        "Set-Cookie",
        `${COOKIE_NAMES.ADMIN_PREFIX}${id}=${adminAccessToken}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`
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
    const view = await svc.getPublicView(id);
    if (!view) {
        const deleted = await svc.isDeleted(id);
        if (deleted) return c.json({ error: "この Office Hour は削除されました", deleted: true }, 410);
        return c.json({ error: "Office Hour not found" }, 404);
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

    // 各スロットの状態を組み立てる
    const slotStates = slots.map((s) => {
        const blocked = isSlotBlockedByBusy(s, busy);
        const taken = slotBookings.countBySlot.get(s.startMs) ?? 0;
        return {
            startMs: s.startMs,
            endMs: s.endMs,
            blocked,
            taken,
            remaining: blocked ? 0 : Math.max(0, view.capacityPerSlot - taken),
        };
    });

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
        const db = createDb(c.env.DB);
        const svc = createOfficeHourService(db);
        const { id } = c.req.valid("param");
        const body = c.req.valid("json");

        const oh = await svc.findById(id);
        if (!oh) return c.json({ error: "この Office Hour は削除されたか存在しません" }, 404);

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
                } else {
                    console.error("[office-hour/book] Google Calendar event creation failed:", calRes.status, await calRes.text().catch(() => ""));
                }
            }
        } catch (e) {
            console.error("[office-hour/book] Failed to create Google Calendar event:", e);
        }

        return c.json({ ok: true, bookingId });
    }
);

/** 管理者ログイン（既存の admin-auth と同じ動作）。 */
officeHoursRoutes.post(
    "/:id/admin-auth",
    sValidator("param", officeHourIdParamSchema),
    sValidator("json", z.object({ password: z.string().min(1).max(256) })),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const { password } = c.req.valid("json");
        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: { adminPasswordHash: true, adminAccessToken: true },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        const ok = await verifyPassword(password, row.adminPasswordHash);
        if (!ok) return c.json({ error: "Invalid password" }, 401);
        c.header(
            "Set-Cookie",
            `${COOKIE_NAMES.ADMIN_PREFIX}${id}=${row.adminAccessToken}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`
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
        const cookieHeader = c.req.header("cookie") ?? "";
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAMES.ADMIN_PREFIX}${id}=([^;]+)`));
        const token = match?.[1];
        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: { adminAccessToken: true, deletedAt: true },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        if (row.deletedAt) return c.json({ error: "既に削除されています" }, 410);
        if (!token || token !== row.adminAccessToken) {
            return c.json({ error: "Unauthorized" }, 401);
        }
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
        // admin auth ヘルパは events 用だが同じ access_token 比較。office_hours 用に簡易再実装。
        const cookieHeader = c.req.header("cookie") ?? "";
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAMES.ADMIN_PREFIX}${id}=([^;]+)`));
        const token = match?.[1];
        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: { adminAccessToken: true, title: true, deletedAt: true },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        if (!token || token !== row.adminAccessToken) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const svc = createOfficeHourService(db);
        const bookings = await svc.listBookingsForAdmin(id);
        return c.json({ title: row.title, bookings, deleted: row.deletedAt !== null });
    }
);

/** 管理者: Office Hour の設定取得。 */
officeHoursRoutes.get(
    "/:id/admin/settings",
    sValidator("param", officeHourIdParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const cookieHeader = c.req.header("cookie") ?? "";
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAMES.ADMIN_PREFIX}${id}=([^;]+)`));
        const token = match?.[1];
        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: {
                adminAccessToken: true,
                title: true,
                description: true,
                startDate: true,
                endDate: true,
                windows: true,
                slotDurationMin: true,
                capacityPerSlot: true,
                bufferMin: true,
                deletedAt: true,
            },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        if (!token || token !== row.adminAccessToken) {
            return c.json({ error: "Unauthorized" }, 401);
        }
        return c.json({
            title: row.title,
            description: row.description,
            startDate: row.startDate,
            endDate: row.endDate,
            windows: JSON.parse(row.windows),
            slotDurationMin: row.slotDurationMin,
            capacityPerSlot: row.capacityPerSlot,
            bufferMin: row.bufferMin,
            deleted: row.deletedAt !== null,
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
        const cookieHeader = c.req.header("cookie") ?? "";
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAMES.ADMIN_PREFIX}${id}=([^;]+)`));
        const token = match?.[1];
        const row = await db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: { adminAccessToken: true, deletedAt: true },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        if (row.deletedAt) return c.json({ error: "この Office Hour は削除されています" }, 410);
        if (!token || token !== row.adminAccessToken) {
            return c.json({ error: "Unauthorized" }, 401);
        }
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
