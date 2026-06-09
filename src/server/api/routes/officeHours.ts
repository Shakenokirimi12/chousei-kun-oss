import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "@/server/db/client";
import { officeHours } from "@/server/db/schema";
import { createOfficeHourService } from "@/server/services/officeHour/officeHour.service";
import { generateSlots, isSlotBlockedByBusy, type WeeklyWindow } from "@/server/services/officeHour/slotGenerator";
import {
    createOfficeHourSchema,
    officeHourIdParamSchema,
    bookOfficeHourSchema,
} from "../schemas";
import { parseCookieValue, refreshGoogleTokenIfNeeded } from "../utils";
import { verifyPassword } from "@/lib/admin-auth";
import { COOKIE_NAMES } from "@/lib/constants";

type Bindings = { DB: D1Database };

export const officeHoursRoutes = new Hono<{ Bindings: Bindings }>();

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
        return c.json({ error: "ユーザー登録が完了していません" }, 400);
    }

    const svc = createOfficeHourService(db);
    const { id, adminAccessToken } = await svc.create({
        title: body.title,
        description: body.description || undefined,
        startDate: body.startDate,
        endDate: body.endDate,
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
    if (!view) return c.json({ error: "Office Hour not found" }, 404);

    const [busy, slotBookings] = await Promise.all([
        svc.getHostBusy(id),
        svc.getSlotBookings(id),
    ]);

    const slots = generateSlots({
        startDate: view.startDate,
        endDate: view.endDate,
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
            startDate: view.startDate,
            endDate: view.endDate,
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
        if (!oh) return c.json({ error: "Office Hour not found" }, 404);

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
        return c.json({ ok: true, bookingId: (r as { ok: true; bookingId: string }).bookingId });
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
            columns: { adminAccessToken: true },
        });
        if (!row) return c.json({ error: "Office Hour not found" }, 404);
        if (!token || token !== row.adminAccessToken) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const svc = createOfficeHourService(db);
        const bookings = await svc.listBookingsForAdmin(id);
        return c.json({ bookings });
    }
);
