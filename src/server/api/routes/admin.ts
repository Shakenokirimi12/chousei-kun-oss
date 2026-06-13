/**
 * 運用専用エンドポイント。`X-Admin-Token` ヘッダで `ADMIN_OPS_TOKEN`
 * (環境変数) と timing-safe 比較した上で実行する。
 *
 * 現在は PII 暗号化バックフィルのみ提供:
 * - participants の name / comment / notification_email を AES-GCM で再保存
 * - office_hour_bookings の name / comment / email を同上
 *
 * 暗号化済みフィールド (enc:v1: プレフィックス付き) はスキップするため、
 * 何度実行しても安全（冪等）。
 */
import { Hono } from "hono";
import { encryptPii, isEncryptedPii } from "@/lib/pii-crypto";
import { timingSafeEqual } from "@/lib/admin-auth";

type Bindings = { DB: D1Database };

export const adminRoutes = new Hono<{ Bindings: Bindings }>();

function authorize(authHeader: string | undefined): boolean {
    const expected = process.env.ADMIN_OPS_TOKEN;
    if (!expected) return false;
    if (!authHeader) return false;
    return timingSafeEqual(authHeader, expected);
}

adminRoutes.post("/backfill-pii", async (c) => {
    if (!authorize(c.req.header("x-admin-token"))) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const stats = {
        participantsScanned: 0,
        participantsUpdated: 0,
        bookingsScanned: 0,
        bookingsUpdated: 0,
    };

    // --- participants ---
    const participantRows = await c.env.DB.prepare(
        `SELECT id, name, comment, notification_email FROM participants`
    ).all<{ id: string; name: string; comment: string | null; notification_email: string | null }>();

    for (const row of participantRows.results) {
        stats.participantsScanned++;
        const nameNeeds = !isEncryptedPii(row.name);
        const commentNeeds = row.comment != null && !isEncryptedPii(row.comment);
        const emailNeeds = row.notification_email != null && !isEncryptedPii(row.notification_email);
        if (!nameNeeds && !commentNeeds && !emailNeeds) continue;

        const newName = nameNeeds ? await encryptPii(row.name) : row.name;
        const newComment = commentNeeds ? await encryptPii(row.comment) : row.comment;
        const newEmail = emailNeeds ? await encryptPii(row.notification_email) : row.notification_email;

        await c.env.DB.prepare(
            `UPDATE participants SET name = ?, comment = ?, notification_email = ? WHERE id = ?`
        ).bind(newName, newComment, newEmail, row.id).run();
        stats.participantsUpdated++;
    }

    // --- office_hour_bookings ---
    const bookingRows = await c.env.DB.prepare(
        `SELECT id, name, comment, email FROM office_hour_bookings`
    ).all<{ id: string; name: string; comment: string | null; email: string | null }>();

    for (const row of bookingRows.results) {
        stats.bookingsScanned++;
        const nameNeeds = !isEncryptedPii(row.name);
        const commentNeeds = row.comment != null && !isEncryptedPii(row.comment);
        const emailNeeds = row.email != null && !isEncryptedPii(row.email);
        if (!nameNeeds && !commentNeeds && !emailNeeds) continue;

        const newName = nameNeeds ? await encryptPii(row.name) : row.name;
        const newComment = commentNeeds ? await encryptPii(row.comment) : row.comment;
        const newEmail = emailNeeds ? await encryptPii(row.email) : row.email;

        await c.env.DB.prepare(
            `UPDATE office_hour_bookings SET name = ?, comment = ?, email = ? WHERE id = ?`
        ).bind(newName, newComment, newEmail, row.id).run();
        stats.bookingsUpdated++;
    }

    return c.json({ ok: true, ...stats });
});
