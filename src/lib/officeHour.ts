/**
 * Office Hour 用のクライアント側ユーティリティ。
 * JST 固定の日付・時刻表示や、API レスポンス型の型定義を提供する。
 */

export const WEEKDAYS_JP = ["日", "月", "火", "水", "木", "金", "土"] as const;

const JST_OFFSET_MIN = 9 * 60;

/** ms epoch を JST の Date に変換する（UTC として扱える日付パーツの抽出用）。 */
function toJst(ms: number): Date {
    return new Date(ms + JST_OFFSET_MIN * 60_000);
}

/** ms epoch を "HH:MM" (JST) で表示。 */
export function formatTime(ms: number): string {
    const d = toJst(ms);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** ms epoch を "M/d (曜)" で表示。 */
export function formatDateLabel(ms: number): string {
    const d = toJst(ms);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAYS_JP[d.getUTCDay()]})`;
}

/** ms epoch を "YYYY-MM-DD" で表示（日付タブのキー用）。 */
export function formatIsoDate(ms: number): string {
    const d = toJst(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** JST の年月日（00:00）に対応する ms epoch を返す。 */
export function jstDayStartMs(year: number, monthIndex: number, day: number): number {
    return Date.UTC(year, monthIndex, day, 0, 0, 0) - JST_OFFSET_MIN * 60_000;
}

/** "YYYY-MM-DD" 文字列を JST の 0:00 ms に変換。 */
export function parseDateInput(value: string): number | null {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return jstDayStartMs(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 公開ビューの API レスポンス型。 */
export type OfficeHourPublic = {
    officeHour: {
        id: string;
        title: string;
        description: string | null;
        startDate: number;
        endDate: number;
        slotDurationMin: number;
        capacityPerSlot: number;
        lastSyncAt: number | null;
    };
    slots: Array<{
        startMs: number;
        endMs: number;
        blocked: boolean;
        taken: number;
        remaining: number;
    }>;
};
