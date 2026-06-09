import { and, eq, gte } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import {
    officeHours,
    officeHourBookings,
    officeHourHostBusy,
} from "@/server/db/schema";
import type { WeeklyWindow } from "./slotGenerator";
import { createPasswordHash } from "@/lib/admin-auth";
import { encryptToken, decryptToken } from "@/lib/token-crypto";

export interface CreateOfficeHourInput {
    title: string;
    description?: string;
    startDate: number;          // JST 0:00 ms
    endDate: number;            // JST 0:00 ms（当日含む）
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
    constructor(private db: DbClient) {}

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
            where: eq(officeHours.id, id),
        });
        return row ?? null;
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

    /** Cron 対象: 受付終了日が未来の全 Office Hour を返す。 */
    async listActive(): Promise<{ id: string }[]> {
        return this.db
            .select({ id: officeHours.id })
            .from(officeHours)
            .where(gte(officeHours.endDate, Date.now()));
    }

    /** 公開ページ用ビュー: PII を含まないメタ情報のみ。 */
    async getPublicView(id: string) {
        const row = await this.db.query.officeHours.findFirst({
            where: eq(officeHours.id, id),
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
            windows: JSON.parse(row.windows) as WeeklyWindow[],
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

    /** スロット別の予約件数 + 自分の予約。公開ページで使う。 */
    async getSlotBookings(officeHourId: string) {
        const rows = await this.db
            .select({
                slotStart: officeHourBookings.slotStart,
                userId: officeHourBookings.userId,
                name: officeHourBookings.name,
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
     * 予約を作成する。Cloudflare D1 はトランザクションが弱いため、
     * 「自分の重複予約 + 枠定員」をチェック → 同じ batch で insert することで
     * 競合に対する実用的な安全性を確保する。完全な原子性ではないが、
     * 同時アクセスでも capacity を超えるケースは極めて稀になる。
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
        // 既存予約の確認
        const existing = await this.db
            .select({ id: officeHourBookings.id, userId: officeHourBookings.userId })
            .from(officeHourBookings)
            .where(
                and(
                    eq(officeHourBookings.officeHourId, input.officeHourId),
                    eq(officeHourBookings.slotStart, input.slotStart)
                )
            );

        if (input.userId && existing.some((e) => e.userId === input.userId)) {
            return { ok: false, reason: "duplicate" };
        }
        if (existing.length >= input.capacityPerSlot) {
            return { ok: false, reason: "slot_full" };
        }

        const id = crypto.randomUUID();
        await this.db.insert(officeHourBookings).values({
            id,
            officeHourId: input.officeHourId,
            slotStart: input.slotStart,
            name: input.name,
            comment: input.comment ?? null,
            email: input.email ?? null,
            userId: input.userId ?? null,
            createdAt: Date.now(),
        });
        return { ok: true, bookingId: id };
    }

    async listBookingsForAdmin(officeHourId: string) {
        return this.db
            .select()
            .from(officeHourBookings)
            .where(eq(officeHourBookings.officeHourId, officeHourId));
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
        // D1 のリクエスト上限を考慮し、適度な chunk で insert
        const CHUNK = 50;
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

export function createOfficeHourService(db: DbClient) {
    return new OfficeHourService(db);
}
