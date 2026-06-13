import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import {
    officeHours,
    officeHourBookings,
    officeHourHostBusy,
} from "@/server/db/schema";
import type { WeeklyWindow } from "./slotGenerator";
import { createPasswordHash } from "@/lib/admin-auth";
import { encryptToken, decryptToken } from "@/lib/token-crypto";
import { encryptPii, decryptPii } from "@/lib/pii-crypto";
import { safeJsonParse } from "@/lib/safe-json";

export interface CreateOfficeHourInput {
    title: string;
    description?: string;
    startDate: number | null;   // JST 0:00 ms。null は「今日から」
    endDate: number | null;     // JST 0:00 ms（当日含む）。null は「無期限」
    windows: WeeklyWindow[];
    slotDurationMin: number;
    capacityPerSlot: number;
    bufferMin?: number;
    adminPassword: string;
    hostUserId: string;
    hostGoogleSessionId: string;
    /** 大学カレンダー(iCal)のURL。保管時は暗号化する。 */
    hostIcalUrl: string;
}

export class OfficeHourService {
    /**
     * @param d1 atomic 操作（予約 INSERT 等）に必要。route から呼ぶ場合は必須。
     *   Cron など atomic 予約を行わない呼び出しでは省略可。
     */
    constructor(private db: DbClient, private d1?: D1Database) {}

    /** 新規 Office Hour を作成。Campus 認証情報は AES-GCM で保存。 */
    async create(input: CreateOfficeHourInput): Promise<{ id: string; adminAccessToken: string }> {
        const id = crypto.randomUUID();
        const adminAccessToken = crypto.randomUUID();
        const adminPasswordHash = await createPasswordHash(input.adminPassword);
        const now = Date.now();

        const encIcalUrl = (await encryptToken(input.hostIcalUrl))!;

        await this.db.insert(officeHours).values({
            id,
            title: input.title,
            description: input.description ?? null,
            startDate: input.startDate,
            endDate: input.endDate,
            windows: JSON.stringify(input.windows),
            slotDurationMin: input.slotDurationMin,
            capacityPerSlot: input.capacityPerSlot,
            bufferMin: input.bufferMin ?? 0,
            adminPasswordHash,
            adminAccessToken,
            hostUserId: input.hostUserId,
            hostGoogleSessionId: input.hostGoogleSessionId,
            hostIcalUrl: encIcalUrl,
            lastSyncAt: null,
            lastSyncError: null,
            createdAt: now,
        });

        return { id, adminAccessToken };
    }

    async findById(id: string) {
        const row = await this.db.query.officeHours.findFirst({
            where: and(eq(officeHours.id, id), isNull(officeHours.deletedAt)),
        });
        return row ?? null;
    }

    async isDeleted(id: string): Promise<boolean> {
        const row = await this.db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
            columns: { deletedAt: true },
        });
        if (!row) return false;
        return row.deletedAt !== null;
    }

    async updateSettings(id: string, patch: {
        title?: string;
        description?: string;
        startDate?: number | null;
        endDate?: number | null;
        windows?: { day: number; start: string; end: string }[];
        slotDurationMin?: number;
        capacityPerSlot?: number;
        bufferMin?: number;
    }): Promise<void> {
        const set: Record<string, unknown> = {};
        if (patch.title !== undefined) set.title = patch.title;
        if (patch.description !== undefined) set.description = patch.description;
        if (patch.startDate !== undefined) set.startDate = patch.startDate;
        if (patch.endDate !== undefined) set.endDate = patch.endDate;
        if (patch.windows !== undefined) set.windows = JSON.stringify(patch.windows);
        if (patch.slotDurationMin !== undefined) set.slotDurationMin = patch.slotDurationMin;
        if (patch.capacityPerSlot !== undefined) set.capacityPerSlot = patch.capacityPerSlot;
        if (patch.bufferMin !== undefined) set.bufferMin = patch.bufferMin;
        if (Object.keys(set).length === 0) return;
        await this.db
            .update(officeHours)
            .set(set)
            .where(and(eq(officeHours.id, id), isNull(officeHours.deletedAt)));
    }

    async softDelete(id: string): Promise<void> {
        await this.db
            .update(officeHours)
            .set({ deletedAt: Date.now() })
            .where(and(eq(officeHours.id, id), isNull(officeHours.deletedAt)));
    }

    /**
     * Cron で使う、復号済みの Campus 認証情報を含む host 連携情報。
     * 認証情報を扱うので呼び出し側は注意。
     */
    async getHostCredentials(id: string) {
        const row = await this.findById(id);
        if (!row) return null;
        return {
            officeHourId: row.id,
            hostUserId: row.hostUserId,
            hostGoogleSessionId: row.hostGoogleSessionId,
            hostIcalUrl: (await decryptToken(row.hostIcalUrl))!,
            startDate: row.startDate,
            endDate: row.endDate,
        };
    }

    async listByHostUser(hostUserId: string) {
        return this.db
            .select({
                id: officeHours.id,
                title: officeHours.title,
                description: officeHours.description,
                startDate: officeHours.startDate,
                endDate: officeHours.endDate,
                slotDurationMin: officeHours.slotDurationMin,
                capacityPerSlot: officeHours.capacityPerSlot,
                lastSyncAt: officeHours.lastSyncAt,
                createdAt: officeHours.createdAt,
            })
            .from(officeHours)
            .where(and(eq(officeHours.hostUserId, hostUserId), isNull(officeHours.deletedAt)));
    }

    /** Cron 対象: 受付終了日が未来 or 無期限の全 Office Hour を返す。 */
    async listActive(): Promise<{ id: string }[]> {
        const rows = await this.db
            .select({ id: officeHours.id, endDate: officeHours.endDate })
            .from(officeHours)
            .where(isNull(officeHours.deletedAt));
        const now = Date.now();
        return rows
            .filter((r) => r.endDate === null || r.endDate >= now)
            .map((r) => ({ id: r.id }));
    }

    /** 公開ページ用ビュー: PII を含まないメタ情報のみ。 */
    async getPublicView(id: string) {
        const row = await this.db.query.officeHours.findFirst({
            where: and(eq(officeHours.id, id), isNull(officeHours.deletedAt)),
            columns: {
                id: true,
                title: true,
                description: true,
                startDate: true,
                endDate: true,
                windows: true,
                slotDurationMin: true,
                capacityPerSlot: true,
                bufferMin: true,
                lastSyncAt: true,
            },
        });
        if (!row) return null;
        return {
            ...row,
            windows: safeJsonParse<WeeklyWindow[]>(row.windows, "office_hours.windows") ?? [],
        };
    }

    async getHostBusy(officeHourId: string) {
        return this.db
            .select({
                source: officeHourHostBusy.source,
                startMs: officeHourHostBusy.startMs,
                endMs: officeHourHostBusy.endMs,
                summary: officeHourHostBusy.summary,
            })
            .from(officeHourHostBusy)
            .where(eq(officeHourHostBusy.officeHourId, officeHourId));
    }

    /**
     * スロット別の予約件数 + 自分の予約情報。公開ページで使う。
     * 公開ページでは PII を返したくないので `name` は返さず、自分の予約判定用に
     * `userId` のみを返す。
     */
    async getSlotBookings(officeHourId: string) {
        const rows = await this.db
            .select({
                slotStart: officeHourBookings.slotStart,
                userId: officeHourBookings.userId,
            })
            .from(officeHourBookings)
            .where(eq(officeHourBookings.officeHourId, officeHourId));
        const countBySlot = new Map<number, number>();
        for (const r of rows) {
            countBySlot.set(r.slotStart, (countBySlot.get(r.slotStart) ?? 0) + 1);
        }
        return { rows, countBySlot };
    }

    /**
     * 予約を作成する。`INSERT ... SELECT WHERE` で
     *   - 既に同一ユーザーの予約が同枠にある（duplicate）
     *   - 枠の現予約数が capacity 以上（slot_full）
     * の条件を SQL レベルで満たしたときのみ insert される。1 ステートメントで
     * 完結するため、check-then-insert の TOCTOU をなくして capacity 超過を防ぐ。
     *
     * 失敗理由を区別するため、insert で rows_written=0 のときに条件を確認し
     * duplicate / slot_full を返す。
     *
     * PII (name / comment / email) は AES-GCM で暗号化して保存する。
     */
    async book(input: {
        officeHourId: string;
        slotStart: number;
        name: string;
        comment?: string;
        email?: string;
        userId?: string;
        capacityPerSlot: number;
    }): Promise<
        | { ok: true; bookingId: string }
        | { ok: false; reason: "slot_full" | "duplicate" }
    > {
        if (!this.d1) {
            throw new Error("OfficeHourService.book requires raw D1 binding");
        }
        const id = crypto.randomUUID();
        const encName = (await encryptPii(input.name))!;
        const encComment = await encryptPii(input.comment ?? null);
        const encEmail = await encryptPii(input.email ?? null);
        const createdAt = Date.now();
        const userIdOrNull = input.userId ?? null;

        // 重複ユーザーは別条件で先にチェック（INSERT WHERE で同じ user_id が
        // 既にあれば slot_full と区別がつかなくなるため）。
        if (input.userId) {
            const dup = await this.d1.prepare(
                `SELECT 1 FROM office_hour_bookings
                 WHERE office_hour_id = ? AND slot_start = ? AND user_id = ? LIMIT 1`
            ).bind(input.officeHourId, input.slotStart, input.userId).first();
            if (dup) return { ok: false, reason: "duplicate" };
        }

        // capacity チェックを内包した条件付き INSERT。
        const res = await this.d1.prepare(
            `INSERT INTO office_hour_bookings
               (id, office_hour_id, slot_start, name, comment, email, user_id, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE (SELECT COUNT(*) FROM office_hour_bookings
                    WHERE office_hour_id = ? AND slot_start = ?) < ?`
        )
            .bind(
                id,
                input.officeHourId,
                input.slotStart,
                encName,
                encComment,
                encEmail,
                userIdOrNull,
                createdAt,
                input.officeHourId,
                input.slotStart,
                input.capacityPerSlot
            )
            .run();

        const written = res.meta?.changes ?? 0;
        if (written === 0) {
            return { ok: false, reason: "slot_full" };
        }
        return { ok: true, bookingId: id };
    }

    async listBookingsForAdmin(officeHourId: string) {
        const rows = await this.db
            .select()
            .from(officeHourBookings)
            .where(eq(officeHourBookings.officeHourId, officeHourId));
        return Promise.all(
            rows.map(async (r) => ({
                ...r,
                name: (await decryptPii(r.name)) ?? "",
                comment: await decryptPii(r.comment),
                email: await decryptPii(r.email),
            }))
        );
    }

    /** 主催者の busy キャッシュを source 単位で洗い替えする。 */
    async replaceHostBusy(
        officeHourId: string,
        source: "google" | "campus",
        events: { startMs: number; endMs: number; summary?: string }[]
    ): Promise<void> {
        // 既存の同 source のレコードを削除
        await this.db
            .delete(officeHourHostBusy)
            .where(
                and(
                    eq(officeHourHostBusy.officeHourId, officeHourId),
                    eq(officeHourHostBusy.source, source)
                )
            );
        if (events.length === 0) return;
        const now = Date.now();
        const rows = events.map((e) => ({
            id: crypto.randomUUID(),
            officeHourId,
            source,
            startMs: e.startMs,
            endMs: e.endMs,
            summary: e.summary ?? null,
            fetchedAt: now,
        }));
        // D1 のリクエスト上限（1クエリあたりバインドパラメータ最大100個）を考慮
        // 1レコード7カラムなので、CHUNK=10 なら 70個 で安全に収まる
        const CHUNK = 10;
        for (let i = 0; i < rows.length; i += CHUNK) {
            await this.db.insert(officeHourHostBusy).values(rows.slice(i, i + CHUNK));
        }
    }

    async setSyncMeta(officeHourId: string, info: { ok: boolean; error?: string }): Promise<void> {
        await this.db
            .update(officeHours)
            .set({
                lastSyncAt: info.ok ? Date.now() : undefined,
                lastSyncError: info.ok ? null : (info.error ?? "unknown error"),
            })
            .where(eq(officeHours.id, officeHourId));
    }
}

export function createOfficeHourService(db: DbClient, d1?: D1Database) {
    return new OfficeHourService(db, d1);
}
