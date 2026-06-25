import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "@/server/db/client";
import { shiftBoards } from "@/server/db/schema";
import { createShiftService } from "@/server/services/shift/shift.service";
import {
    createShiftBoardSchema,
    updateShiftBoardSchema,
    shiftBoardIdParamSchema,
    ownShiftMemberParamSchema,
    submitShiftMemberSchema,
    setShiftAssignmentsSchema,
    publishShiftBoardSchema,
} from "../schemas";
import { verifyPassword, createPasswordHash } from "@/lib/admin-auth";
import { COOKIE_NAMES } from "@/lib/constants";
import { verifyShiftAdminSession, isSameOrigin } from "../middleware";
import { enforceRateLimit, clientIp, type RateLimitBinding } from "../rate-limit";

type Bindings = {
    DB: D1Database;
    AUTH_RATE_LIMITER?: RateLimitBinding;
    WRITE_RATE_LIMITER?: RateLimitBinding;
};

export const shiftsRoutes = new Hono<{ Bindings: Bindings }>();

// CSRF: 状態変更系には同一オリジン検証を必須化（他機能と同方針）。
shiftsRoutes.use("*", async (c, next) => {
    const method = c.req.method;
    if (method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT") {
        if (!isSameOrigin(c)) {
            return c.json({ error: "Cross-origin request rejected" }, 403);
        }
    }
    return next();
});

/** 自分（デバイス userId）が作成したシフト表一覧。認証は持たず userId をキーにする。 */
shiftsRoutes.get("/by-creator/:userId", async (c) => {
    const userId = c.req.param("userId");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return c.json({ error: "Invalid userId" }, 400);
    }
    const db = createDb(c.env.DB);
    const svc = createShiftService(db);
    const items = await svc.listByCreator(userId);
    return c.json({ items });
});

/** 作成。Google 連携は不要。admin cookie を即発行する。 */
shiftsRoutes.post("/", sValidator("json", createShiftBoardSchema), async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.DB);
    const svc = createShiftService(db);
    const { id, adminAccessToken } = await svc.create({
        title: body.title,
        description: body.description || undefined,
        date: body.date,
        submissionDeadline: body.submissionDeadline ?? null,
        slots: body.slots,
        adminPassword: body.adminPassword,
        createdByUserId: body.creatorUserId,
    });

    c.header(
        "Set-Cookie",
        `${COOKIE_NAMES.ADMIN_PREFIX}${id}=${adminAccessToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`
    );
    return c.json({ id }, 201);
});

/** 公開ビュー: board メタ + 枠（+ published 時は確定割当）。 */
shiftsRoutes.get("/:id", sValidator("param", shiftBoardIdParamSchema), async (c) => {
    const db = createDb(c.env.DB);
    const svc = createShiftService(db);
    const { id } = c.req.valid("param");
    const view = await svc.getPublicView(id);
    if (!view) {
        const deleted = await svc.isDeleted(id);
        if (deleted) return c.json({ error: "このシフト表は削除されました", deleted: true }, 410);
        return c.json({ error: "Shift board not found" }, 404);
    }
    return c.json(view);
});

/** 本人向け: 自分の登録内容（氏名・NG・確定割当）。memberId を知っている本人のみ。 */
shiftsRoutes.get(
    "/:id/member/:memberId",
    sValidator("param", ownShiftMemberParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const svc = createShiftService(db);
        const { id, memberId } = c.req.valid("param");
        const member = await svc.getMember(id, memberId);
        if (!member) return c.json({ error: "Member not found" }, 404);
        return c.json(member);
    }
);

/** メンバー登録 + NG 申告（upsert）。userId で本人を識別し再提出を許す。 */
shiftsRoutes.post(
    "/:id/members",
    sValidator("param", shiftBoardIdParamSchema),
    sValidator("json", submitShiftMemberSchema),
    async (c) => {
        const { id } = c.req.valid("param");
        const allowed = await enforceRateLimit(
            c.env.WRITE_RATE_LIMITER,
            `shift-member:${id}:${clientIp(c)}`
        );
        if (!allowed) {
            return c.json({ error: "送信が多すぎます。しばらくしてから再度お試しください。" }, 429);
        }
        const db = createDb(c.env.DB);
        const svc = createShiftService(db, c.env.DB);
        const board = await svc.findById(id);
        if (!board) return c.json({ error: "このシフト表は削除されたか存在しません" }, 404);
        if (board.status === "published") {
            return c.json({ error: "このシフト表は既に公開されており、NG の変更はできません" }, 409);
        }
        if (board.submissionDeadline !== null && Date.now() > board.submissionDeadline) {
            return c.json({ error: "NG の提出期限を過ぎています" }, 409);
        }

        const body = c.req.valid("json");
        const { memberId } = await svc.upsertMember({
            boardId: id,
            memberId: body.memberId,
            userId: body.userId,
            name: body.name,
            comment: body.comment || undefined,
            unavailableSlotIds: body.unavailableSlotIds,
        });
        return c.json({ ok: true, memberId });
    }
);

/** 管理者ログイン（既存 admin-auth と同じ動作）。 */
shiftsRoutes.post(
    "/:id/admin-auth",
    sValidator("param", shiftBoardIdParamSchema),
    sValidator("json", z.object({ password: z.string().min(1).max(256) })),
    async (c) => {
        const { id } = c.req.valid("param");
        const allowed = await enforceRateLimit(
            c.env.AUTH_RATE_LIMITER,
            `shift-auth:${id}:${clientIp(c)}`
        );
        if (!allowed) {
            return c.json({ error: "試行回数が多すぎます。しばらくしてから再度お試しください。" }, 429);
        }
        const db = createDb(c.env.DB);
        const { password } = c.req.valid("json");
        const row = await db.query.shiftBoards.findFirst({
            where: eq(shiftBoards.id, id),
            columns: { adminPasswordHash: true, adminAccessToken: true },
        });
        if (!row) return c.json({ error: "Shift board not found" }, 404);
        const result = await verifyPassword(password, row.adminPasswordHash);
        if (!result.ok) return c.json({ error: "Invalid password" }, 401);
        if (result.needsRehash) {
            try {
                const upgraded = await createPasswordHash(password);
                await db.update(shiftBoards).set({ adminPasswordHash: upgraded }).where(eq(shiftBoards.id, id));
            } catch (e) {
                console.error("[shift admin-auth] hash upgrade failed:", e);
            }
        }
        c.header(
            "Set-Cookie",
            `${COOKIE_NAMES.ADMIN_PREFIX}${id}=${row.adminAccessToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`
        );
        return c.json({ ok: true });
    }
);

/** 管理者ビュー: メンバー(NG付き) + 確定割当 + 枠 + タイトル。 */
shiftsRoutes.get(
    "/:id/admin",
    sValidator("param", shiftBoardIdParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyShiftAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);

        const svc = createShiftService(db);
        const board = await svc.findById(id);
        if (!board) return c.json({ error: "Shift board not found" }, 404);
        const [slots, adminView] = await Promise.all([svc.getSlots(id), svc.getAdminView(id)]);
        return c.json({
            board: {
                id: board.id,
                title: board.title,
                description: board.description,
                date: board.date,
                status: board.status,
                submissionDeadline: board.submissionDeadline,
            },
            slots,
            members: adminView.members,
            assignments: adminView.assignments,
            deleted: auth.deleted ?? false,
        });
    }
);

/** 管理者: 割当を一括置換。 */
shiftsRoutes.put(
    "/:id/assignments",
    sValidator("param", shiftBoardIdParamSchema),
    sValidator("json", setShiftAssignmentsSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyShiftAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);
        if (auth.deleted) return c.json({ error: "このシフト表は削除されています" }, 410);
        const { assignments } = c.req.valid("json");
        const svc = createShiftService(db);
        await svc.setAssignments(id, assignments);
        return c.json({ ok: true });
    }
);

/** 管理者: 自動割当の提案を返す（保存はしない）。 */
shiftsRoutes.post(
    "/:id/auto-assign",
    sValidator("param", shiftBoardIdParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyShiftAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);
        const svc = createShiftService(db);
        const assignments = await svc.suggestAssignments(id);
        return c.json({ assignments });
    }
);

/** 管理者: 公開状態を切り替え。 */
shiftsRoutes.post(
    "/:id/publish",
    sValidator("param", shiftBoardIdParamSchema),
    sValidator("json", publishShiftBoardSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyShiftAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);
        if (auth.deleted) return c.json({ error: "このシフト表は削除されています" }, 410);
        const { published } = c.req.valid("json");
        const svc = createShiftService(db);
        await svc.setPublished(id, published);
        return c.json({ ok: true });
    }
);

/** 管理者: タイトル・日付・枠などを更新。 */
shiftsRoutes.patch(
    "/:id",
    sValidator("param", shiftBoardIdParamSchema),
    sValidator("json", updateShiftBoardSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const body = c.req.valid("json");
        const auth = await verifyShiftAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);
        if (auth.deleted) return c.json({ error: "このシフト表は削除されています" }, 410);
        const svc = createShiftService(db);
        await svc.updateBoard(id, body);
        return c.json({ ok: true });
    }
);

/** 管理者: シフト表を論理削除。 */
shiftsRoutes.delete(
    "/:id",
    sValidator("param", shiftBoardIdParamSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const auth = await verifyShiftAdminSession(c, id);
        if (!auth.authorized) return c.json({ error: auth.error }, 401);
        if (auth.deleted) return c.json({ error: "既に削除されています" }, 410);
        const svc = createShiftService(db);
        await svc.softDelete(id);
        return c.json({ ok: true });
    }
);
