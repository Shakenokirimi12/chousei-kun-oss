import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import {
    shiftBoards,
    shiftSlots,
    shiftMembers,
    shiftUnavailabilities,
    shiftAssignments,
} from "@/server/db/schema";
import { createPasswordHash } from "@/lib/admin-auth";
import { encryptPii, decryptPii } from "@/lib/pii-crypto";

export interface ShiftSlotInput {
    id?: string;
    startsAt: number;
    endsAt: number;
    role: string;
    place?: string;
    capacity: number;
    sortOrder?: number;
}

export interface CreateShiftBoardInput {
    title: string;
    description?: string;
    date: number;
    submissionDeadline?: number | null;
    slots: ShiftSlotInput[];
    adminPassword: string;
    createdByUserId?: string;
}

/** タイムライン上のシフト枠（PII を含まない公開情報）。 */
export interface SlotView {
    id: string;
    startsAt: number;
    endsAt: number;
    role: string;
    place: string | null;
    capacity: number;
    sortOrder: number;
}

export class ShiftService {
    /**
     * @param d1 NG 申告の UPSERT 等で raw D1 を使う。route から呼ぶ場合は渡すこと。
     */
    constructor(private db: DbClient, private d1?: D1Database) {}

    /** シフト表 + 枠を新規作成。admin 認証は既存パターン（PBKDF2 + token cookie）。 */
    async create(input: CreateShiftBoardInput): Promise<{ id: string; adminAccessToken: string }> {
        const id = crypto.randomUUID();
        const adminAccessToken = crypto.randomUUID();
        const adminPasswordHash = await createPasswordHash(input.adminPassword);
        const now = Date.now();

        await this.db.insert(shiftBoards).values({
            id,
            title: input.title,
            description: input.description ?? null,
            date: input.date,
            status: "collecting",
            submissionDeadline: input.submissionDeadline ?? null,
            adminPasswordHash,
            adminAccessToken,
            createdByUserId: input.createdByUserId ?? null,
            createdAt: now,
        });

        await this.insertSlots(id, input.slots);

        return { id, adminAccessToken };
    }

    private async insertSlots(boardId: string, slots: ShiftSlotInput[]): Promise<void> {
        const rows = slots.map((s, i) => ({
            id: s.id ?? crypto.randomUUID(),
            boardId,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            role: s.role,
            place: s.place && s.place.length > 0 ? s.place : null,
            capacity: s.capacity,
            sortOrder: s.sortOrder ?? i,
        }));
        // D1 のバインド上限を考慮し分割（1行7カラム → CHUNK=12 で 84 個）。
        const CHUNK = 12;
        for (let i = 0; i < rows.length; i += CHUNK) {
            await this.db.insert(shiftSlots).values(rows.slice(i, i + CHUNK));
        }
    }

    async findById(id: string) {
        const row = await this.db.query.shiftBoards.findFirst({
            where: and(eq(shiftBoards.id, id), isNull(shiftBoards.deletedAt)),
        });
        return row ?? null;
    }

    async isDeleted(id: string): Promise<boolean> {
        const row = await this.db.query.shiftBoards.findFirst({
            where: eq(shiftBoards.id, id),
            columns: { deletedAt: true },
        });
        if (!row) return false;
        return row.deletedAt !== null;
    }

    async getSlots(boardId: string): Promise<SlotView[]> {
        const rows = await this.db
            .select()
            .from(shiftSlots)
            .where(eq(shiftSlots.boardId, boardId));
        return rows
            .map((r) => ({
                id: r.id,
                startsAt: r.startsAt,
                endsAt: r.endsAt,
                role: r.role,
                place: r.place,
                capacity: r.capacity,
                sortOrder: r.sortOrder,
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.startsAt - b.startsAt);
    }

    /**
     * 公開ビュー。常に board メタ + 枠を返す。published のときは確定割当も
     * メンバー表示名つきで返す（シフト表は共有が目的のため氏名を含める）。
     */
    async getPublicView(id: string) {
        const board = await this.findById(id);
        if (!board) return null;
        const slots = await this.getSlots(id);

        let assignments: { slotId: string; memberId: string; name: string }[] = [];
        if (board.status === "published") {
            assignments = await this.listAssignmentsWithNames(id);
        }

        return {
            board: {
                id: board.id,
                title: board.title,
                description: board.description,
                date: board.date,
                status: board.status,
                submissionDeadline: board.submissionDeadline,
            },
            slots,
            assignments,
        };
    }

    /** 割当 + メンバー表示名。published 公開ビューと admin ビューの双方で使う。 */
    private async listAssignmentsWithNames(
        boardId: string
    ): Promise<{ slotId: string; memberId: string; name: string }[]> {
        const rows = await this.db
            .select({
                slotId: shiftAssignments.slotId,
                memberId: shiftAssignments.memberId,
                name: shiftMembers.name,
            })
            .from(shiftAssignments)
            .innerJoin(shiftMembers, eq(shiftAssignments.memberId, shiftMembers.id))
            .where(eq(shiftMembers.boardId, boardId));
        return Promise.all(
            rows.map(async (r) => ({
                slotId: r.slotId,
                memberId: r.memberId,
                name: (await decryptPii(r.name)) ?? "",
            }))
        );
    }

    /** 既存メンバーを userId か memberId で探す。再提出の本人判定に使う。 */
    private async findMember(boardId: string, opts: { memberId?: string; userId?: string }) {
        if (opts.memberId) {
            const row = await this.db.query.shiftMembers.findFirst({
                where: and(eq(shiftMembers.id, opts.memberId), eq(shiftMembers.boardId, boardId)),
            });
            if (row) return row;
        }
        if (opts.userId) {
            const row = await this.db.query.shiftMembers.findFirst({
                where: and(eq(shiftMembers.boardId, boardId), eq(shiftMembers.userId, opts.userId)),
            });
            if (row) return row;
        }
        return null;
    }

    /**
     * メンバー登録 + NG 申告の upsert。name/comment は暗号化保存。
     * unavailableSlotIds は当該メンバーの NG をまるごと置き換える。
     * board に属さない slotId は無視する。
     */
    async upsertMember(input: {
        boardId: string;
        memberId?: string;
        userId?: string;
        name: string;
        comment?: string;
        unavailableSlotIds: string[];
    }): Promise<{ memberId: string }> {
        const encName = (await encryptPii(input.name))!;
        const encComment = await encryptPii(input.comment ?? null);
        const now = Date.now();

        const existing = await this.findMember(input.boardId, {
            memberId: input.memberId,
            userId: input.userId,
        });

        let memberId: string;
        if (existing) {
            memberId = existing.id;
            await this.db
                .update(shiftMembers)
                .set({ name: encName, comment: encComment })
                .where(eq(shiftMembers.id, memberId));
        } else {
            memberId = crypto.randomUUID();
            await this.db.insert(shiftMembers).values({
                id: memberId,
                boardId: input.boardId,
                userId: input.userId ?? null,
                name: encName,
                comment: encComment,
                createdAt: now,
            });
        }

        // board に属する有効な slotId だけに絞る。
        const validSlotIds = new Set((await this.getSlots(input.boardId)).map((s) => s.id));
        const slotIds = [...new Set(input.unavailableSlotIds)].filter((sid) => validSlotIds.has(sid));

        // NG をまるごと置き換える（DELETE → INSERT）。
        await this.db
            .delete(shiftUnavailabilities)
            .where(eq(shiftUnavailabilities.memberId, memberId));
        if (slotIds.length > 0) {
            const rows = slotIds.map((slotId) => ({ memberId, slotId }));
            const CHUNK = 40;
            for (let i = 0; i < rows.length; i += CHUNK) {
                await this.db.insert(shiftUnavailabilities).values(rows.slice(i, i + CHUNK));
            }
        }

        return { memberId };
    }

    /** 本人向け: 自分の登録内容（氏名・コメント・NG・確定割当）を取得。 */
    async getMember(boardId: string, memberId: string) {
        const member = await this.db.query.shiftMembers.findFirst({
            where: and(eq(shiftMembers.id, memberId), eq(shiftMembers.boardId, boardId)),
        });
        if (!member) return null;
        const [ng, assigned] = await Promise.all([
            this.db
                .select({ slotId: shiftUnavailabilities.slotId })
                .from(shiftUnavailabilities)
                .where(eq(shiftUnavailabilities.memberId, memberId)),
            this.db
                .select({ slotId: shiftAssignments.slotId })
                .from(shiftAssignments)
                .where(eq(shiftAssignments.memberId, memberId)),
        ]);
        return {
            id: member.id,
            name: (await decryptPii(member.name)) ?? "",
            comment: await decryptPii(member.comment),
            unavailableSlotIds: ng.map((r) => r.slotId),
            assignedSlotIds: assigned.map((r) => r.slotId),
        };
    }

    /**
     * 管理者ビュー: メンバー一覧（復号済み氏名 + NG）と確定割当をまとめて返す。
     */
    async getAdminView(boardId: string) {
        const [memberRows, ngRows, assignments] = await Promise.all([
            this.db
                .select({
                    id: shiftMembers.id,
                    name: shiftMembers.name,
                    comment: shiftMembers.comment,
                    createdAt: shiftMembers.createdAt,
                })
                .from(shiftMembers)
                .where(eq(shiftMembers.boardId, boardId)),
            this.db
                .select({
                    memberId: shiftUnavailabilities.memberId,
                    slotId: shiftUnavailabilities.slotId,
                })
                .from(shiftUnavailabilities)
                .innerJoin(shiftMembers, eq(shiftUnavailabilities.memberId, shiftMembers.id))
                .where(eq(shiftMembers.boardId, boardId)),
            this.listAssignments(boardId),
        ]);

        const ngByMember = new Map<string, string[]>();
        for (const r of ngRows) {
            const arr = ngByMember.get(r.memberId) ?? [];
            arr.push(r.slotId);
            ngByMember.set(r.memberId, arr);
        }

        const members = await Promise.all(
            memberRows.map(async (m) => ({
                id: m.id,
                name: (await decryptPii(m.name)) ?? "",
                comment: await decryptPii(m.comment),
                unavailableSlotIds: ngByMember.get(m.id) ?? [],
            }))
        );
        members.sort((a, b) => a.name.localeCompare(b.name, "ja"));

        return { members, assignments };
    }

    private async listAssignments(boardId: string): Promise<{ slotId: string; memberId: string }[]> {
        return this.db
            .select({ slotId: shiftAssignments.slotId, memberId: shiftAssignments.memberId })
            .from(shiftAssignments)
            .innerJoin(shiftSlots, eq(shiftAssignments.slotId, shiftSlots.id))
            .where(eq(shiftSlots.boardId, boardId));
    }

    /**
     * 割当をまるごと置き換える。board に属さない slot/member のペアは捨てる。
     * 容量・NG はフロントで警告する方針のためここでは強制しない（管理者の上書きを許す）。
     */
    async setAssignments(
        boardId: string,
        pairs: { slotId: string; memberId: string }[]
    ): Promise<void> {
        const validSlotIds = new Set((await this.getSlots(boardId)).map((s) => s.id));
        const memberRows = await this.db
            .select({ id: shiftMembers.id })
            .from(shiftMembers)
            .where(eq(shiftMembers.boardId, boardId));
        const validMemberIds = new Set(memberRows.map((m) => m.id));

        const clean = pairs.filter(
            (p) => validSlotIds.has(p.slotId) && validMemberIds.has(p.memberId)
        );
        // 重複ペアを除去。
        const seen = new Set<string>();
        const rows: { slotId: string; memberId: string }[] = [];
        for (const p of clean) {
            const key = `${p.slotId} ${p.memberId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({ slotId: p.slotId, memberId: p.memberId });
        }

        // 既存割当を全削除（board の slot に紐づくもの）。
        const slotIds = [...validSlotIds];
        const CHUNK = 80;
        for (let i = 0; i < slotIds.length; i += CHUNK) {
            await this.db
                .delete(shiftAssignments)
                .where(inArray(shiftAssignments.slotId, slotIds.slice(i, i + CHUNK)));
        }
        for (let i = 0; i < rows.length; i += 40) {
            await this.db.insert(shiftAssignments).values(rows.slice(i, i + 40));
        }
    }

    /**
     * 自動割当の提案を計算（保存はしない）。NG と定員を厳守し、
     * 現在の割当数が少ないメンバーを優先してバランスよく埋める貪欲法。
     */
    async suggestAssignments(boardId: string): Promise<{ slotId: string; memberId: string }[]> {
        const { members } = await this.getAdminView(boardId);
        const slots = await this.getSlots(boardId);

        const ngByMember = new Map<string, Set<string>>(
            members.map((m) => [m.id, new Set(m.unavailableSlotIds)])
        );
        const load = new Map<string, number>(members.map((m) => [m.id, 0]));

        // 時間順に枠を処理。各枠で NG でない・時間が重複しないメンバーを負荷の低い順に詰める。
        const ordered = [...slots].sort((a, b) => a.startsAt - b.startsAt);
        const assignedSpans = new Map<string, { startsAt: number; endsAt: number }[]>();
        const result: { slotId: string; memberId: string }[] = [];

        for (const slot of ordered) {
            const candidates = members
                .filter((m) => !ngByMember.get(m.id)!.has(slot.id))
                .filter((m) => {
                    const spans = assignedSpans.get(m.id) ?? [];
                    return !spans.some((s) => slot.startsAt < s.endsAt && s.startsAt < slot.endsAt);
                })
                .sort((a, b) => (load.get(a.id)! - load.get(b.id)!));

            for (const m of candidates.slice(0, slot.capacity)) {
                result.push({ slotId: slot.id, memberId: m.id });
                load.set(m.id, load.get(m.id)! + 1);
                const spans = assignedSpans.get(m.id) ?? [];
                spans.push({ startsAt: slot.startsAt, endsAt: slot.endsAt });
                assignedSpans.set(m.id, spans);
            }
        }
        return result;
    }

    /** タイトル・説明・日付・締切・枠を更新（編集ページ）。枠は差分適用。 */
    async updateBoard(
        id: string,
        patch: {
            title?: string;
            description?: string;
            date?: number;
            submissionDeadline?: number | null;
            slots?: ShiftSlotInput[];
        }
    ): Promise<void> {
        const set: Record<string, unknown> = {};
        if (patch.title !== undefined) set.title = patch.title;
        if (patch.description !== undefined) set.description = patch.description;
        if (patch.date !== undefined) set.date = patch.date;
        if (patch.submissionDeadline !== undefined) set.submissionDeadline = patch.submissionDeadline;
        if (Object.keys(set).length > 0) {
            await this.db
                .update(shiftBoards)
                .set(set)
                .where(and(eq(shiftBoards.id, id), isNull(shiftBoards.deletedAt)));
        }

        if (patch.slots !== undefined) {
            await this.applySlotDiff(id, patch.slots);
        }
    }

    /**
     * 枠の差分適用。incoming の id 付き枠は更新、id 無しは新規、incoming に
     * 含まれない既存枠は削除（cascade で NG・割当も消える）。
     */
    private async applySlotDiff(boardId: string, slots: ShiftSlotInput[]): Promise<void> {
        const existing = await this.db
            .select({ id: shiftSlots.id })
            .from(shiftSlots)
            .where(eq(shiftSlots.boardId, boardId));
        const existingIds = new Set(existing.map((s) => s.id));
        const incomingIds = new Set(slots.filter((s) => s.id).map((s) => s.id!));

        // 削除対象
        const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
        if (toDelete.length > 0) {
            const CHUNK = 80;
            for (let i = 0; i < toDelete.length; i += CHUNK) {
                await this.db
                    .delete(shiftSlots)
                    .where(inArray(shiftSlots.id, toDelete.slice(i, i + CHUNK)));
            }
        }

        // 更新 / 新規
        const toInsert: ShiftSlotInput[] = [];
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (s.id && existingIds.has(s.id)) {
                await this.db
                    .update(shiftSlots)
                    .set({
                        startsAt: s.startsAt,
                        endsAt: s.endsAt,
                        role: s.role,
                        place: s.place && s.place.length > 0 ? s.place : null,
                        capacity: s.capacity,
                        sortOrder: s.sortOrder ?? i,
                    })
                    .where(eq(shiftSlots.id, s.id));
            } else {
                toInsert.push({ ...s, sortOrder: s.sortOrder ?? i });
            }
        }
        if (toInsert.length > 0) {
            await this.insertSlots(boardId, toInsert);
        }
    }

    async setPublished(id: string, published: boolean): Promise<void> {
        await this.db
            .update(shiftBoards)
            .set({ status: published ? "published" : "collecting" })
            .where(and(eq(shiftBoards.id, id), isNull(shiftBoards.deletedAt)));
    }

    async softDelete(id: string): Promise<void> {
        await this.db
            .update(shiftBoards)
            .set({ deletedAt: Date.now() })
            .where(and(eq(shiftBoards.id, id), isNull(shiftBoards.deletedAt)));
    }

    async listByCreator(userId: string) {
        return this.db
            .select({
                id: shiftBoards.id,
                title: shiftBoards.title,
                date: shiftBoards.date,
                status: shiftBoards.status,
                createdAt: shiftBoards.createdAt,
            })
            .from(shiftBoards)
            .where(and(eq(shiftBoards.createdByUserId, userId), isNull(shiftBoards.deletedAt)));
    }
}

export function createShiftService(db: DbClient, d1?: D1Database) {
    return new ShiftService(db, d1);
}
