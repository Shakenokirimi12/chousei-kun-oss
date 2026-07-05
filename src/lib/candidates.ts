import { format } from "date-fns";
import { ja } from "date-fns/locale";

/**
 * 終日候補: `YYYY-MM-DD_D`。
 * 時限 `YYYY-MM-DD_P<n>` / 時間 `YYYY-MM-DD_H<n>` と同じ配列に混在させることは
 * できない（schemas.ts の candidatesSchema で同一種別を強制）。
 */
export function isAllDayCandidate(candidate: string): boolean {
    return candidate.endsWith("_D");
}

/** イベントが「日毎の出欠確認（終日）」かどうか。全候補が終日形式のときのみ true。 */
export function isAllDayEvent(candidates: string[]): boolean {
    return candidates.length > 0 && candidates.every(isAllDayCandidate);
}

/**
 * 候補文字列の日付部分をローカル時刻の Date として返す。
 * `new Date("YYYY-MM-DD")` は UTC 深夜になり JST 表示で日付が保てるのは偶然なので、
 * 明示的にローカル構築する。
 */
export function parseCandidateDate(candidate: string): Date | null {
    const [datePart] = candidate.split("_");
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart ?? "");
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 終日候補の短いラベル: `7/10(金)` */
export function formatAllDayCandidateLabel(candidate: string): string {
    const date = parseCandidateDate(candidate);
    if (!date) return candidate;
    return format(date, "M/d(E)", { locale: ja });
}

/** 終日候補の長いラベル: `2026年7月10日(金) 終日` */
export function formatAllDayCandidateLabelLong(candidate: string): string {
    const date = parseCandidateDate(candidate);
    if (!date) return candidate;
    return `${format(date, "yyyy年M月d日(E)", { locale: ja })} 終日`;
}

/** `YYYY-MM-DD` の翌日を `YYYY-MM-DD` で返す（終日イベントの排他的終了日用）。 */
export function nextDateString(dateStr: string): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return next.toISOString().slice(0, 10);
}

/**
 * 日付文字列（`YYYY-MM-DD` 先頭一致、なければ任意の日時文字列）をローカル日付
 * （時刻0時）にそろえてパースする。終日予定の重なり判定を日付単位で行うための
 * 正規化。無効な入力は null。
 */
export function parseDateOnly(raw: string | undefined | null): Date | null {
    if (!raw) return null;
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (dateMatch) {
        const [, y, m, d] = dateMatch;
        return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/**
 * 終日予定（start/end は ISO 相当の日時文字列）が実際に重なる日付（`YYYY-MM-DD`）の
 * 一覧を返す。end は排他的終了日として扱う（1日分の予定でも end==start や
 * end が欠落している場合は最低1日分とみなす）。
 *
 * 終日候補の自動×判定（回答フォーム）と「×の理由」表示（終日モードUI）の両方が
 * この関数を使うことで、判定結果に食い違いが出ないようにする。
 */
export function allDayEventDateRange(start: string, end: string): string[] {
    const startDay = parseDateOnly(start);
    let endDay = parseDateOnly(end);
    if (!startDay) return [];
    if (!endDay || endDay <= startDay) {
        endDay = new Date(startDay);
        endDay.setDate(startDay.getDate() + 1);
    }
    const days: string[] = [];
    const cursor = new Date(startDay);
    while (cursor < endDay) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        days.push(`${y}-${m}-${d}`);
        cursor.setDate(cursor.getDate() + 1);
    }
    return days;
}
