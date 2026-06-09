"use client";

import * as React from "react";
import { Calendar as CalendarIcon, GraduationCap, Loader2, AlertCircle, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { formatTime, formatDateLabel, formatIsoDate, jstDayStartMs } from "@/lib/officeHour";
import { cn } from "@/lib/utils";

type BusyEvent = {
    source: "google" | "ical";
    startMs: number;
    endMs: number;
    summary: string;
};

type GoogleEvent = {
    dtstart: string;
    dtend: string;
    summary: string;
};
type ICalEvent = {
    dtstart: string;
    dtend: string;
    summary: string;
};

const DAYS_TO_PREVIEW = 7;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;

type WeeklyWindow = {
    day: number;
    start: string;
    end: string;
};

type OfficeHourSlot = {
    startMs: number;
    endMs: number;
};

function parseHm(hm: string): number {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
}

function generatePreviewSlots(
    startMs: number,
    daysCount: number,
    windows: WeeklyWindow[],
    slotDurationMin: number,
    bufferMin: number
): OfficeHourSlot[] {
    const byDay = new Map<number, WeeklyWindow[]>();
    for (const w of windows) {
        const arr = byDay.get(w.day) ?? [];
        arr.push(w);
        byDay.set(w.day, arr);
    }
    const result: OfficeHourSlot[] = [];
    for (let i = 0; i < daysCount; i++) {
        const dayStart = startMs + i * 24 * 60 * 60_000;
        const jst = new Date(dayStart + 9 * 60 * 60_000);
        const weekday = jst.getUTCDay();
        const todays = byDay.get(weekday) ?? [];
        for (const w of todays) {
            const wStartMin = parseHm(w.start);
            const wEndMin = parseHm(w.end);
            let slotStartMin = wStartMin;
            while (slotStartMin + slotDurationMin <= wEndMin) {
                const sMs = dayStart + slotStartMin * 60_000;
                result.push({ startMs: sMs, endMs: sMs + slotDurationMin * 60_000 });
                slotStartMin += slotDurationMin + bufferMin;
            }
        }
    }
    return result;
}

export function SchedulePreview({
    icalUrl,
    windows = [],
    slotDurationMin = 30,
    bufferMin = 0,
}: {
    icalUrl: string;
    windows?: WeeklyWindow[];
    slotDurationMin?: number;
    bufferMin?: number;
}) {
    const [events, setEvents] = React.useState<BusyEvent[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [googleError, setGoogleError] = React.useState<string | null>(null);
    const [icalError, setIcalError] = React.useState<string | null>(null);
    const [weekOffset, setWeekOffset] = React.useState(0);

    const fetchedIcalRef = React.useRef<string>("");

    const todayMs = React.useMemo(() => {
        const now = new Date();
        const jst = new Date(now.getTime() + 9 * 60 * 60_000);
        return jstDayStartMs(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
    }, []);
    const startMs = todayMs + weekOffset * DAYS_TO_PREVIEW * 24 * 60 * 60_000;
    const endMs = startMs + DAYS_TO_PREVIEW * 24 * 60 * 60_000;

    // 初回 + iCal URL 変化時に取り直す
    React.useEffect(() => {
        let cancelled = false;

        const fetchGoogle = async (): Promise<BusyEvent[]> => {
            try {
                const res = await fetch("/api/google/calendar/events");
                if (!res.ok) {
                    setGoogleError("Googleカレンダー取得に失敗しました（未連携または権限不足）");
                    return [];
                }
                setGoogleError(null);
                const data = (await res.json()) as { events?: GoogleEvent[] };
                return (data.events ?? [])
                    .map((e) => ({
                        source: "google" as const,
                        startMs: Date.parse(e.dtstart),
                        endMs: Date.parse(e.dtend),
                        summary: e.summary || "予定",
                    }))
                    .filter((e) => !Number.isNaN(e.startMs) && !Number.isNaN(e.endMs))
                    .filter((e) => e.endMs >= startMs && e.startMs <= endMs);
            } catch (e) {
                console.error(e);
                setGoogleError("Googleカレンダー取得中にエラーが発生しました");
                return [];
            }
        };

        const fetchIcal = async (): Promise<BusyEvent[]> => {
            if (!icalUrl) {
                setIcalError(null);
                return [];
            }
            try {
                const res = await fetch("/api/sync-ical", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: icalUrl }),
                });
                if (!res.ok) {
                    setIcalError("iCal URLの読み込みに失敗しました（URLが正しいかご確認ください）");
                    return [];
                }
                setIcalError(null);
                const data = (await res.json()) as { events?: ICalEvent[] };
                return (data.events ?? [])
                    .map((e) => ({
                        source: "ical" as const,
                        startMs: Date.parse(e.dtstart),
                        endMs: Date.parse(e.dtend),
                        summary: e.summary || "予定",
                    }))
                    .filter((e) => !Number.isNaN(e.startMs) && !Number.isNaN(e.endMs))
                    .filter((e) => e.endMs >= startMs && e.startMs <= endMs);
            } catch (e) {
                console.error(e);
                setIcalError("iCal URLの読み込み中にエラーが発生しました");
                return [];
            }
        };

        const run = async () => {
            setIsLoading(true);
            const [g, i] = await Promise.all([fetchGoogle(), icalUrl ? fetchIcal() : Promise.resolve([])]);
            if (cancelled) return;
            fetchedIcalRef.current = icalUrl;
            setEvents([...g, ...i]);
            setIsLoading(false);
        };

        run();
        return () => { cancelled = true; };
    }, [icalUrl, startMs, endMs]);

    // 日別にバケットへ
    const days = React.useMemo(() => {
        const list: { iso: string; label: string; dayStartMs: number; events: BusyEvent[] }[] = [];
        for (let i = 0; i < DAYS_TO_PREVIEW; i++) {
            const dayStart = startMs + i * 24 * 60 * 60_000;
            list.push({
                iso: formatIsoDate(dayStart),
                label: formatDateLabel(dayStart),
                dayStartMs: dayStart,
                events: [],
            });
        }
        for (const ev of events) {
            const iso = formatIsoDate(ev.startMs);
            const day = list.find((d) => d.iso === iso);
            if (day) day.events.push(ev);
        }
        return list;
    }, [events, startMs]);

    const previewSlots = React.useMemo(() => {
        if (windows.length === 0 || slotDurationMin <= 0) return new Map<string, OfficeHourSlot[]>();
        const slots = generatePreviewSlots(startMs, DAYS_TO_PREVIEW, windows, slotDurationMin, bufferMin);
        const byDay = new Map<string, OfficeHourSlot[]>();
        for (const s of slots) {
            const iso = formatIsoDate(s.startMs);
            const arr = byDay.get(iso) ?? [];
            arr.push(s);
            byDay.set(iso, arr);
        }
        return byDay;
    }, [startMs, windows, slotDurationMin, bufferMin]);

    const isSlotBlocked = React.useCallback(
        (slot: OfficeHourSlot) => events.some((ev) => slot.startMs < ev.endMs && ev.startMs < slot.endMs),
        [events]
    );

    const { timelineStartHour, timelineEndHour, timelineHours } = React.useMemo(() => {
        let minH = DEFAULT_START_HOUR;
        let maxH = DEFAULT_END_HOUR;
        for (const w of windows) {
            const sh = Math.floor(parseHm(w.start) / 60);
            const eh = Math.ceil(parseHm(w.end) / 60);
            if (sh < minH) minH = sh;
            if (eh > maxH) maxH = eh;
        }
        for (const ev of events) {
            const sJst = new Date(ev.startMs + 9 * 60 * 60_000);
            const eJst = new Date(ev.endMs + 9 * 60 * 60_000);
            const sh = sJst.getUTCHours();
            const eh = eJst.getUTCMinutes() > 0 ? eJst.getUTCHours() + 1 : eJst.getUTCHours();
            if (sh < minH) minH = sh;
            if (eh > maxH) maxH = eh;
        }
        minH = Math.max(0, minH);
        maxH = Math.min(24, maxH);
        if (maxH - minH < 4) maxH = Math.min(24, minH + 4);
        return { timelineStartHour: minH, timelineEndHour: maxH, timelineHours: maxH - minH };
    }, [windows, events]);

    const weekLabel = React.useMemo(() => {
        const s = formatDateLabel(startMs);
        const e = formatDateLabel(startMs + 6 * 24 * 60 * 60_000);
        return `${s} 〜 ${e}`;
    }, [startMs]);

    return (
        <div className="flex flex-col h-full gap-1.5">
            {/* ヘッダー: タイトル + 週切替 + 凡例 */}
            <div className="shrink-0 flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Eye className="h-4 w-4" aria-hidden="true" /> プレビュー
                </h2>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setWeekOffset((p) => p - 1)}
                        disabled={weekOffset <= 0}
                        className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="前の週"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs text-muted-foreground min-w-[140px] text-center">
                        {weekOffset === 0 ? "今週" : weekLabel}
                    </span>
                    <button
                        type="button"
                        onClick={() => setWeekOffset((p) => p + 1)}
                        className="p-1 rounded hover:bg-accent transition-colors"
                        aria-label="次の週"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    {weekOffset !== 0 && (
                        <button
                            type="button"
                            onClick={() => setWeekOffset(0)}
                            className="text-[10px] text-primary hover:text-primary/80 ml-1"
                        >
                            今週に戻る
                        </button>
                    )}
                </div>
                <div className="flex gap-2.5 text-[11px] text-muted-foreground ml-auto">
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/30 border border-emerald-500/50" /> 受付枠
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500/30 border border-red-500/50" /> 競合
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500/70 border border-blue-500" /> Google
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/70 border border-amber-500" /> 大学
                    </span>
                    {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
            </div>

            {/* エラー表示 */}
            {(googleError || icalError) && (
                <div className="shrink-0 space-y-1">
                    {googleError && (
                        <div role="status" className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                            <CalendarIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" /> {googleError}
                        </div>
                    )}
                    {icalError && (
                        <div role="status" className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                            <GraduationCap className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" /> {icalError}
                        </div>
                    )}
                </div>
            )}

            {/* タイムライン本体 — 親の高さいっぱいに広がる */}
            <div className="flex-1 min-h-0 rounded-md border bg-card/20 flex flex-col">
                {/* ヘッダー: 日付 */}
                <div className="grid grid-cols-[36px_repeat(7,minmax(0,1fr))] border-b bg-muted/20 shrink-0">
                    <div />
                    {days.map((d) => (
                        <div key={d.iso} className="text-xs text-center py-1.5 border-l first:border-l-0 font-medium">
                            {d.label}
                        </div>
                    ))}
                </div>

                {/* ボディ */}
                <div className="grid grid-cols-[36px_repeat(7,minmax(0,1fr))] flex-1 min-h-0">
                    {/* 時間軸 */}
                    <div className="relative border-r">
                        {Array.from({ length: timelineHours + 1 }).map((_, i) => {
                            const h = timelineStartHour + i;
                            const pct = (i / timelineHours) * 100;
                            return (
                                <div
                                    key={h}
                                    className="absolute right-1 text-[10px] text-muted-foreground -translate-y-1/2"
                                    style={{ top: `${pct}%` }}
                                >
                                    {h}:00
                                </div>
                            );
                        })}
                    </div>

                    {/* 各日のレーン */}
                    {days.map((d) => (
                        <div key={d.iso} className="relative border-l first:border-l-0">
                            {/* グリッド線 */}
                            {Array.from({ length: timelineHours + 1 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="absolute w-full border-t border-border/30"
                                    style={{ top: `${(i / timelineHours) * 100}%` }}
                                />
                            ))}
                            {/* Office Hour スロット（背景レイヤー） */}
                            {(previewSlots.get(d.iso) ?? []).map((slot, si) => {
                                const sStartPct = minToPctDyn(relMinFromHour(slot.startMs, timelineStartHour), timelineHours);
                                const sEndPct = minToPctDyn(relMinFromHour(slot.endMs, timelineStartHour), timelineHours);
                                const topPct = Math.max(0, sStartPct);
                                const bottomPct = Math.min(100, sEndPct);
                                if (bottomPct <= 0 || topPct >= 100) return null;
                                const blocked = isSlotBlocked(slot);
                                return (
                                    <div
                                        key={`slot-${si}`}
                                        title={`${blocked ? "競合" : "受付枠"} ${formatTime(slot.startMs)}〜${formatTime(slot.endMs)}`}
                                        className={cn(
                                            "absolute inset-x-0 rounded-[2px] border-l-2",
                                            blocked
                                                ? "bg-red-500/15 border-l-red-500/60"
                                                : "bg-emerald-500/15 border-l-emerald-500/60"
                                        )}
                                        style={{ top: `${topPct}%`, height: `${Math.max(0.5, bottomPct - topPct)}%` }}
                                    />
                                );
                            })}
                            {/* イベントブロック */}
                            {d.events.map((ev, j) => {
                                const startPct = minToPctDyn(relMinFromHour(ev.startMs, timelineStartHour), timelineHours);
                                const endPct = minToPctDyn(relMinFromHour(ev.endMs, timelineStartHour), timelineHours);
                                const topPct = Math.max(0, startPct);
                                const bottomPct = Math.min(100, endPct);
                                if (bottomPct <= 0 || topPct >= 100) return null;
                                return (
                                    <div
                                        key={j}
                                        title={`${ev.summary} (${formatTime(ev.startMs)}〜${formatTime(ev.endMs)})`}
                                        className={cn(
                                            "absolute inset-x-0.5 rounded-sm border text-[10px] px-1 py-0.5 overflow-hidden",
                                            ev.source === "google"
                                                ? "bg-blue-500/25 border-blue-500/50 text-blue-700 dark:text-blue-300"
                                                : "bg-amber-500/25 border-amber-500/50 text-amber-700 dark:text-amber-300"
                                        )}
                                        style={{ top: `${topPct}%`, height: `${Math.max(1, bottomPct - topPct)}%` }}
                                    >
                                        <div className="font-medium leading-tight truncate">{ev.summary}</div>
                                        <div className="text-[9px] opacity-80 leading-tight">{formatTime(ev.startMs)}〜</div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function relMinFromHour(ms: number, startHour: number): number {
    const jst = new Date(ms + 9 * 60 * 60_000);
    const min = jst.getUTCHours() * 60 + jst.getUTCMinutes();
    return min - startHour * 60;
}

function minToPctDyn(min: number, totalHours: number): number {
    return (min / (totalHours * 60)) * 100;
}
