import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { allDayEventDateRange } from "@/lib/candidates";

/** An imported all-day event with JST "YYYY-MM-DD" dates; end is exclusive. */
export type AllDayEventRange = { start: string; end: string; summary: string };

const JST_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" });

/** Today's date in JST as "YYYY-MM-DD", optionally shifted by offsetMs. */
export function jstDateStr(offsetMs = 0): string {
    return JST_DATE_FORMAT.format(new Date(Date.now() + offsetMs));
}

// iCal and Campus Square send all-day dates as JST midnight in UTC ISO form
// ("...T15:00:00.000Z" of the previous day). Read the date in JST so the event lands on
// the right day regardless of the browser timezone.
function toAllDayDateStr(raw: string | undefined): string {
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? "" : JST_DATE_FORMAT.format(d);
}

/** Normalizes raw all-day dates to JST "YYYY-MM-DD" with an exclusive end of at least one day. */
export function normalizeAllDayEvent(startRaw: string | undefined, endRaw: string | undefined, summary: string): AllDayEventRange | null {
    const start = toAllDayDateStr(startRaw);
    if (!start) return null;
    let end = toAllDayDateStr(endRaw);
    if (!end || end <= start) {
        const minEnd = new Date(`${start}T00:00:00`);
        minEnd.setDate(minEnd.getDate() + 1);
        end = format(minEnd, "yyyy-MM-dd");
    }
    return { start, end, summary };
}

/**
 * Trims an all-day event to [from, to) before it is expanded into per-day entries.
 * A feed can carry an event spanning years, and expanding all of it would freeze the page.
 */
export function clipAllDayEvent<T extends AllDayEventRange>(ev: T, from: string, to: string): T | null {
    const start = ev.start > from ? ev.start : from;
    const end = ev.end < to ? ev.end : to;
    return start < end ? { ...ev, start, end } : null;
}

/** Whether the normalized all-day event covers dateStr ("YYYY-MM-DD"). */
export function allDayEventCovers(ev: AllDayEventRange, dateStr: string): boolean {
    return dateStr >= ev.start && dateStr < ev.end;
}

/** "11/3(火)" or "11/3(火)〜11/5(木)" for a normalized all-day event. */
export function formatAllDayRange(ev: AllDayEventRange): string {
    const start = new Date(`${ev.start}T00:00:00`);
    const last = new Date(`${ev.end}T00:00:00`);
    last.setDate(last.getDate() - 1);
    const startLabel = format(start, "M/d(E)", { locale: ja });
    return last > start ? `${startLabel}〜${format(last, "M/d(E)", { locale: ja })}` : startLabel;
}

/** Splits a normalized all-day event into local midnight-to-midnight blocks for the timelines. */
export function expandAllDayToBlocks(ev: AllDayEventRange): { start: string; end: string }[] {
    return allDayEventDateRange(ev.start, ev.end).map((dateStr) => {
        const start = new Date(`${dateStr}T00:00:00`);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { start: start.toISOString(), end: end.toISOString() };
    });
}
