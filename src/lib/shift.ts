/**
 * シフト調整のクライアント側ユーティリティと API レスポンス型。
 * 時刻は board.date（JST 0:00 ms）からの「分」で扱い、タイムライン描画では
 * TZ 非依存の純粋な算術で位置を決める。
 */

export type ShiftSlot = {
    id: string;
    startsAt: number;
    endsAt: number;
    role: string;
    place: string | null;
    capacity: number;
    sortOrder: number;
};

export type ShiftBoardMeta = {
    id: string;
    title: string;
    description: string | null;
    date: number;
    status: "collecting" | "published";
    submissionDeadline: number | null;
};

export type ShiftAssignment = { slotId: string; memberId: string; name?: string };

export type ShiftPublicView = {
    board: ShiftBoardMeta;
    slots: ShiftSlot[];
    assignments: ShiftAssignment[];
};

export type ShiftMemberDetail = {
    id: string;
    name: string;
    comment: string | null;
    unavailableSlotIds: string[];
    assignedSlotIds: string[];
};

export type ShiftAdminMember = {
    id: string;
    name: string;
    comment: string | null;
    unavailableSlotIds: string[];
};

export type ShiftAdminView = {
    board: ShiftBoardMeta;
    slots: ShiftSlot[];
    members: ShiftAdminMember[];
    assignments: { slotId: string; memberId: string }[];
    deleted: boolean;
};

/** board.date 起点の「分」へ。TZ 非依存（ms 差の純算術）。 */
export function msToMinutes(ms: number, baseDate: number): number {
    return Math.round((ms - baseDate) / 60_000);
}

/** board.date 起点の「分」を絶対 ms へ。 */
export function minutesToMs(min: number, baseDate: number): number {
    return baseDate + min * 60_000;
}

/** 分（0..1440+）を "HH:MM" 表示に。24:00 超も素直に桁上げ表示。 */
export function formatMinutes(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" を分に。失敗時は null。 */
export function parseHm(value: string): number | null {
    const m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (mm > 59) return null;
    return h * 60 + mm;
}

/** 2 つの枠（分レンジ）が時間的に重なるか。 */
export function rangesOverlap(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number
): boolean {
    return aStart < bEnd && bStart < aEnd;
}

export const SNAP_MINUTES = 5;

/** 分を SNAP 単位に丸める。 */
export function snap(min: number, snapTo = SNAP_MINUTES): number {
    return Math.round(min / snapTo) * snapTo;
}
