/**
 * Office Hour のスロット生成（純粋関数）。
 *
 * 入力: 受付期間（startDate/endDate ms epoch, UTC基準ではなくJST固定の「日」単位で扱う）
 *       + 曜日別の受付時間帯 windows
 *       + 1枠の長さ
 *       + 枠間バッファ
 *
 * 出力: スロット開始時刻(ms epoch) の配列。JST固定で計算する。
 *
 * 設計メモ:
 * - タイムゾーンは Asia/Tokyo（既存アプリと統一）。Date オブジェクトは UTC で動くため、
 *   JST(+09:00) を明示してパースし直す。
 * - 「日」境界は JST 00:00。startDate/endDate は当日 00:00 を期待。
 */

export type WeeklyWindow = {
    /** 0=日, 1=月, ... 6=土 */
    day: number;
    /** "HH:MM" 24h */
    start: string;
    /** "HH:MM" 24h */
    end: string;
};

const JST_OFFSET_MIN = 9 * 60;

/** 無期限指定時のデフォルト表示窓 (90日分) */
export const OPEN_ENDED_DAYS = 90;

function parseHm(hm: string): number {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
}

/**
 * null 許容の startDate/endDate から、実際に使う表示範囲（JST 0:00 ms）を決定する。
 * - startDate が null なら「今日(JST)の 0:00」
 * - endDate が null なら startDate + OPEN_ENDED_DAYS - 1 日
 */
export function resolveDateRange(opts: {
    startDate: number | null;
    endDate: number | null;
    now?: number;
}): { startDate: number; endDate: number } {
    const now = opts.now ?? Date.now();
    const todayParts = toJstParts(now);
    const todayMs = jstDayStartMs(todayParts.year, todayParts.monthIndex, todayParts.day);
    const startDate = opts.startDate ?? todayMs;
    const endDate = opts.endDate ?? startDate + (OPEN_ENDED_DAYS - 1) * 24 * 60 * 60_000;
    return { startDate, endDate };
}

/** JST の年月日（0:00）に対応する ms epoch を返す。 */
function jstDayStartMs(year: number, monthIndex: number, day: number): number {
    // JST 00:00 = UTC 15:00 前日
    return Date.UTC(year, monthIndex, day, 0, 0, 0) - JST_OFFSET_MIN * 60_000;
}

/** ms を JST の Date 系（年月日, 曜日, 時分）に分解する。 */
function toJstParts(ms: number) {
    const d = new Date(ms + JST_OFFSET_MIN * 60_000);
    return {
        year: d.getUTCFullYear(),
        monthIndex: d.getUTCMonth(),
        day: d.getUTCDate(),
        weekday: d.getUTCDay(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
    };
}

/**
 * 受付期間と曜日別 windows から、duration ごとのスロット開始時刻リストを生成する。
 * バッファは「枠の後ろ」に付くものとして扱う（次の枠開始 = 前枠終了 + buffer）。
 *
 * @param opts.startDate JST 0:00 を表す ms（startDate 当日を含む）
 * @param opts.endDate JST 0:00 を表す ms（endDate 当日も含む = inclusive）
 */
export function generateSlots(opts: {
    startDate: number;
    endDate: number;
    windows: WeeklyWindow[];
    slotDurationMin: number;
    bufferMin?: number;
}): { startMs: number; endMs: number }[] {
    const { startDate, endDate, windows, slotDurationMin } = opts;
    const buffer = opts.bufferMin ?? 0;
    if (slotDurationMin <= 0) return [];

    // 曜日 -> windows
    const byDay = new Map<number, WeeklyWindow[]>();
    for (const w of windows) {
        const arr = byDay.get(w.day) ?? [];
        arr.push(w);
        byDay.set(w.day, arr);
    }

    const result: { startMs: number; endMs: number }[] = [];
    const startParts = toJstParts(startDate);
    let cursor = jstDayStartMs(startParts.year, startParts.monthIndex, startParts.day);

    // 安全策: ループ上限（例: 366日 * 1日48枠 = 17568 程度を超えたら打ち切り）
    const HARD_LIMIT = 50_000;
    let produced = 0;

    while (cursor <= endDate) {
        const p = toJstParts(cursor);
        const todays = byDay.get(p.weekday) ?? [];
        for (const w of todays) {
            const startMinOfDay = parseHm(w.start);
            const endMinOfDay = parseHm(w.end);
            let slotStartMin = startMinOfDay;
            while (slotStartMin + slotDurationMin <= endMinOfDay) {
                const startMs = cursor + slotStartMin * 60_000;
                const endMs = startMs + slotDurationMin * 60_000;
                result.push({ startMs, endMs });
                produced++;
                if (produced >= HARD_LIMIT) return result;
                slotStartMin += slotDurationMin + buffer;
            }
        }
        // 翌日に進める（UTC 演算では DST が無い JST なので 24h 加算で十分）
        cursor += 24 * 60 * 60_000;
    }

    return result;
}

/**
 * スロットが host の busy 期間と重なるか判定。
 * busy は [start, end) の半開区間として扱う。
 */
export function isSlotBlockedByBusy(
    slot: { startMs: number; endMs: number },
    busyList: { startMs: number; endMs: number }[]
): boolean {
    for (const b of busyList) {
        if (slot.startMs < b.endMs && b.startMs < slot.endMs) return true;
    }
    return false;
}
