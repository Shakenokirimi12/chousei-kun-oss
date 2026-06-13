"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Copy, ZoomIn, ZoomOut, AlertTriangle, Info, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

import { CUSTOM_PERIODS } from "@/config/periods";
import CustomPeriodsGridComponent from "@/components/CustomPeriodsGrid";

export { CUSTOM_PERIODS };

// Render CustomPeriodsGrid only if CUSTOM_PERIODS is not empty.
const CustomPeriodsGrid = CUSTOM_PERIODS.length > 0 ? CustomPeriodsGridComponent : null;

export const HOURLY_SLOTS = Array.from({ length: 24 }, (_, i) => {
    const hour = i;
    return {
        id: hour,
        label: `${hour}:00`,
        time: `${hour}:00-${hour + 1}:00`
    };
});

interface PeriodSelectorProps {
    selectedPeriods: string[]; // Format: "YYYY-MM-DD_P#" or "YYYY-MM-DD_H#"
    onChange: (periods: string[]) => void;
    busyPeriodIds?: string[]; 
    busyEvents?: { start: string; end: string; summary: string }[];
}

export function PeriodSelector({
    selectedPeriods,
    onChange,
    busyPeriodIds = [],
    busyEvents = []
}: PeriodSelectorProps) {
    const deriveDatesFromPeriods = React.useCallback((periods: string[]) => {
        const datesMap = new Map<string, Date>();
        periods.forEach((period) => {
            const [dateStr] = period.split("_");
            if (!dateStr) return;
            if (!datesMap.has(dateStr)) {
                datesMap.set(dateStr, new Date(dateStr));
            }
        });
        return Array.from(datesMap.values()).sort((a, b) => a.getTime() - b.getTime());
    }, []);

    const [viewDates, setViewDates] = React.useState<Date[]>(() => {
        const derived = deriveDatesFromPeriods(selectedPeriods);
        return derived.length > 0 ? derived : [new Date()];
    });
    // Track which date is currently "active" for quick selection
    const [focusedDate, setFocusedDate] = React.useState<Date | null>(() => {
        const derived = deriveDatesFromPeriods(selectedPeriods);
        return derived[0] ?? new Date();
    });
    // Zoom level state (1.2 = default)
    const [zoomLevel, setZoomLevel] = React.useState(1.2);
    // Hourly range picker state (defaults: 9:00 - 17:00)
    const [rangeStart, setRangeStart] = React.useState("09:00");
    const [rangeEnd, setRangeEnd] = React.useState("17:00");
    // 繰り返し追加: focusedDate の選択を N 回先まで同曜日に展開する
    const [recurrencePeriod, setRecurrencePeriod] = React.useState<"weekly" | "biweekly" | "monthly">("weekly");
    const [recurrenceCount, setRecurrenceCount] = React.useState(4);

    // Synchronize viewDates with selectedPeriods (for AI additions)
    React.useEffect(() => {
        const derivedDates = deriveDatesFromPeriods(selectedPeriods);
        setViewDates(prev => {
            const next = [...prev];
            let changed = false;
            derivedDates.forEach(dd => {
                if (!next.some(d => format(d, "yyyy-MM-dd") === format(dd, "yyyy-MM-dd"))) {
                    next.push(dd);
                    changed = true;
                }
            });
            if (changed) {
                return next.sort((a, b) => a.getTime() - b.getTime());
            }
            return prev;
        });
    }, [selectedPeriods, deriveDatesFromPeriods]);

    // Handle date selection from Calendar
    const onSelectDates = (dates: Date[] | undefined) => {
        if (!dates) return;
        const sorted = dates.sort((a, b) => a.getTime() - b.getTime());

        // Find newly added date if any
        let newDateToFocus = null;
        if (sorted.length > viewDates.length) {
            // Something added
            newDateToFocus = sorted.find(d => !viewDates.some(vd => vd.getTime() === d.getTime()));
        }

        // Find removed dates and clean up their periods from selectedPeriods
        const removedDates = viewDates.filter(vd => !sorted.some(d => d.getTime() === vd.getTime()));
        if (removedDates.length > 0) {
            const removedDateStrs = removedDates.map(d => format(d, "yyyy-MM-dd"));
            const cleanedPeriods = selectedPeriods.filter(p => {
                const [dateStr] = p.split("_");
                return !removedDateStrs.includes(dateStr);
            });
            if (cleanedPeriods.length !== selectedPeriods.length) {
                onChange(cleanedPeriods);
            }
        }

        setViewDates(sorted);

        // Auto-focus logic
        if (newDateToFocus) {
            setFocusedDate(newDateToFocus);
        } else if (sorted.length === 0) {
            setFocusedDate(null);
        } else if (focusedDate && !sorted.some(d => d.getTime() === focusedDate.getTime())) {
            setFocusedDate(sorted[0]);
        } else if (!focusedDate && sorted.length > 0) {
            setFocusedDate(sorted[0]);
        }
    };

    // Helper to parse time string "HH:MM" to minutes from 0:00
    const parseTimeToMinutes = (timeStr: string) => {
        const [h, m] = timeStr.trim().split(":").map(Number);
        return h * 60 + m;
    };

    // Calculate position and height for a time range
    // Base start time: 00:00 (0 minutes)
    // Scale: 1 minute = H px
    const START_HOUR = 0;
    const END_HOUR = 24;
    const START_MINUTES = START_HOUR * 60;
    const PIXELS_PER_MINUTE = zoomLevel; // Tied to state for zooming

    // Helper to get exact slot info
    const getSlotInfo = (type: "P" | "H", id: number) => {
        if (type === "P") {
            const p = CUSTOM_PERIODS.find(x => x.id === id);
            if (!p) return null;
            const [start, end] = p.time.split("-");
            return {
                startMin: parseTimeToMinutes(start),
                endMin: parseTimeToMinutes(end),
                label: `${p.id}限`,
                sub: p.time
            };
        }
        const h = HOURLY_SLOTS.find(x => x.id === id);
        if (!h) return null;
        const [start, end] = h.time.split("-");
        return {
            startMin: parseTimeToMinutes(start),
            endMin: parseTimeToMinutes(end),
            label: `${h.id}:00`,
            sub: h.time
        };
    };

    const getBlockStyle = (startMin: number, endMin: number) => {
        const top = (startMin - START_MINUTES) * PIXELS_PER_MINUTE;
        const height = (endMin - startMin) * PIXELS_PER_MINUTE;
        return { top: `${top}px`, height: `${height}px` };
    };

    const togglePeriod = (dateStr: string, id: number, type: "P" | "H") => {
        const key = `${dateStr}_${type}${id}`;
        if (selectedPeriods.includes(key)) {
            onChange(selectedPeriods.filter((p) => p !== key));
        } else {
            // Check for potential conflicts? (Optional enhancement later)
            onChange([...selectedPeriods, key]);
        }
    };

    // Toggle a period for the FOCUSED date only
    const toggleFocusedPeriod = (id: number, type: "P" | "H") => {
        if (!focusedDate) return;

        const dateStr = format(focusedDate, "yyyy-MM-dd");
        togglePeriod(dateStr, id, type);
    };

    const copyDaySelections = (sourceDateStr: string) => {
        const sourceSelections = selectedPeriods
            .filter(p => p.startsWith(sourceDateStr))
            .map(p => p.split("_")[1]);

        if (sourceSelections.length === 0) return;

        let newSelected = [...selectedPeriods];
        viewDates.forEach(date => {
            const targetDateStr = format(date, "yyyy-MM-dd");
            if (targetDateStr === sourceDateStr) return;

            sourceSelections.forEach(slot => {
                const key = `${targetDateStr}_${slot}`;
                if (!newSelected.includes(key)) {
                    newSelected.push(key);
                }
            });
        });
        onChange(newSelected);
    };

    const selectDayPeriods = () => {
        if (!focusedDate) return;
        const dateStr = format(focusedDate, "yyyy-MM-dd");
        const periodSlots = CUSTOM_PERIODS.map(p => `${dateStr}_P${p.id}`);
        const otherSelections = selectedPeriods.filter(p => !p.startsWith(dateStr) || !p.includes("_P"));
        onChange([...otherSelections, ...periodSlots]);
    };

    const selectDayHourly = () => {
        if (!focusedDate) return;
        const dateStr = format(focusedDate, "yyyy-MM-dd");
        const hourlySlots = HOURLY_SLOTS.map(h => `${dateStr}_H${h.id}`);
        const otherSelections = selectedPeriods.filter(p => !p.startsWith(dateStr) || !p.includes("_H"));
        onChange([...otherSelections, ...hourlySlots]);
    };

    const clearDayAll = () => {
        if (!focusedDate) return;
        const dateStr = format(focusedDate, "yyyy-MM-dd");
        onChange(selectedPeriods.filter(p => !p.startsWith(dateStr)));
    };

    // Parse "HH:MM" → hour integer (rounded down). Returns null on invalid.
    const parseHour = (value: string): number | null => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(value);
        if (!m) return null;
        const h = Number(m[1]);
        if (!Number.isFinite(h) || h < 0 || h > 23) return null;
        return h;
    };

    const applyHourlyRange = (mode: "add" | "remove") => {
        if (!focusedDate) return;
        const start = parseHour(rangeStart);
        const end = parseHour(rangeEnd);
        if (start === null || end === null || end <= start) return;
        const dateStr = format(focusedDate, "yyyy-MM-dd");
        const targetKeys = new Set(
            HOURLY_SLOTS
                .filter(h => h.id >= start && h.id < end)
                .map(h => `${dateStr}_H${h.id}`)
        );
        if (mode === "add") {
            const next = [...selectedPeriods];
            targetKeys.forEach(k => {
                if (!next.includes(k)) next.push(k);
            });
            onChange(next);
        } else {
            onChange(selectedPeriods.filter(p => !targetKeys.has(p)));
        }
    };

    /**
     * focusedDate に現在選択されているスロット（_P / _H）を、
     * 「毎週／隔週／月次同曜日」のパターンで未来方向に N 回複製する。
     * すでに同じキーが存在する場合は重複させない。
     */
    const applyRecurrence = () => {
        if (!focusedDate) return;
        const srcDateStr = format(focusedDate, "yyyy-MM-dd");
        const sourceSlots = selectedPeriods
            .filter((p) => p.startsWith(srcDateStr))
            .map((p) => p.split("_")[1]); // 例: "P3", "H10"
        if (sourceSlots.length === 0) return;

        const stepDays = recurrencePeriod === "weekly" ? 7 : recurrencePeriod === "biweekly" ? 14 : null;
        const newViewDates = [...viewDates];
        const next = [...selectedPeriods];

        for (let i = 1; i <= recurrenceCount; i++) {
            const target = new Date(focusedDate);
            if (stepDays !== null) {
                target.setDate(target.getDate() + stepDays * i);
            } else {
                // monthly: 同じ曜日週次でない、同じ日付（例: 毎月13日）
                target.setMonth(target.getMonth() + i);
            }
            const dateStr = format(target, "yyyy-MM-dd");
            if (!newViewDates.some((d) => format(d, "yyyy-MM-dd") === dateStr)) {
                newViewDates.push(target);
            }
            sourceSlots.forEach((slot) => {
                const key = `${dateStr}_${slot}`;
                if (!next.includes(key)) next.push(key);
            });
        }
        newViewDates.sort((a, b) => a.getTime() - b.getTime());
        setViewDates(newViewDates);
        onChange(next);
    };

    const renderTimeAxis = () => {
        const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
        return (
            <div className="relative w-12 flex-shrink-0 border-r bg-background/50 backdrop-blur z-20">
                {hours.map(h => (
                    <div
                        key={h}
                        className="absolute w-full text-right pr-2 text-xs text-muted-foreground -translate-y-1/2 border-t border-transparent"
                        style={{ top: `${(h * 60 - START_MINUTES) * PIXELS_PER_MINUTE}px` }}
                    >
                        {h}:00
                    </div>
                ))}
            </div>
        );
    };

    const renderGridLines = () => {
        const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
        return (
            <div className="absolute inset-0 pointer-events-none z-0">
                {hours.map(h => (
                    <div
                        key={h}
                        className="absolute w-full border-t border-border/40 dashed"
                        style={{ top: `${(h * 60 - START_MINUTES) * PIXELS_PER_MINUTE}px` }}
                    />
                ))}
            </div>
        );
    };

    return (
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 h-full w-full overflow-hidden">
            {/* Left Sidebar */}
            <div className="flex-none w-full md:w-72 flex flex-col gap-4 overflow-y-auto min-h-0 h-full pb-4 md:pb-0 shrink-0 max-h-[50vh] md:max-h-full">
                <div className="rounded-md border bg-card p-3 shadow-sm shrink-0">
                    <h3 className="font-semibold text-sm mb-3 px-2">日付を選択</h3>
                    <Calendar
                        mode="multiple"
                        selected={viewDates}
                        onSelect={onSelectDates}
                        className="rounded-md border bg-background"
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        locale={ja}
                    />
                </div>

                {/* 編集対象日のサブヘッダー + リセット — 操作の文脈を明示 */}
                {focusedDate ? (
                    <div className="rounded-md bg-accent/60 px-3 py-2 flex items-center justify-between shrink-0">
                        <div className="flex flex-col leading-tight">
                            <span className="text-[10px] text-muted-foreground">時間帯を編集中</span>
                            <span className="text-sm font-semibold">
                                {format(focusedDate, "M月d日(E)", { locale: ja })}
                            </span>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[10px] text-muted-foreground"
                            onClick={clearDayAll}
                            title="この日の選択を全解除"
                        >
                            <RotateCcw className="w-3 h-3 mr-1" />
                            リセット
                        </Button>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed bg-card p-4 text-center text-xs text-muted-foreground shrink-0">
                        左のカレンダーから日付を選んでください
                    </div>
                )}

                {focusedDate && (
                    <div className="rounded-md border bg-card p-3 shadow-sm flex flex-col shrink-0">
                        <Tabs defaultValue="time" className="w-full">
                            <TabsList className="grid w-full grid-cols-3 h-8 mb-3">
                                <TabsTrigger value="time" className="text-[11px]">時間</TabsTrigger>
                                <TabsTrigger value="period" className="text-[11px]" disabled={CUSTOM_PERIODS.length === 0}>
                                    時限
                                </TabsTrigger>
                                <TabsTrigger value="recur" className="text-[11px]">繰り返し</TabsTrigger>
                            </TabsList>

                            {/* タブ1: 時間範囲 */}
                            <TabsContent value="time" className="mt-0 space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <Input
                                        type="time"
                                        step={3600}
                                        min="00:00"
                                        max="23:00"
                                        value={rangeStart}
                                        onChange={(e) => setRangeStart(e.target.value)}
                                        className="h-9 px-2 text-sm tabular-nums flex-1"
                                        aria-label="開始時刻"
                                    />
                                    <span className="text-xs text-muted-foreground">〜</span>
                                    <Input
                                        type="time"
                                        step={3600}
                                        min="01:00"
                                        max="24:00"
                                        value={rangeEnd}
                                        onChange={(e) => setRangeEnd(e.target.value)}
                                        className="h-9 px-2 text-sm tabular-nums flex-1"
                                        aria-label="終了時刻"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    className="w-full h-9 text-xs"
                                    onClick={() => applyHourlyRange("add")}
                                >
                                    この範囲を候補に追加
                                </Button>
                                <div className="flex items-center justify-between text-[10px]">
                                    <button
                                        type="button"
                                        onClick={selectDayHourly}
                                        className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                                    >
                                        1日中を選ぶ
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => applyHourlyRange("remove")}
                                        className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                                    >
                                        この範囲を外す
                                    </button>
                                </div>
                                <div className="flex items-start gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                                    <Info className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                                    <p className="text-[10px] text-muted-foreground leading-snug">
                                        個別の時間は右のタイムラインをクリックでも切替できます。
                                    </p>
                                </div>
                            </TabsContent>

                            {/* タブ2: 時限 (カスタム枠) */}
                            <TabsContent value="period" className="mt-0 space-y-2">
                                <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    className="w-full h-9 text-xs"
                                    onClick={selectDayPeriods}
                                >
                                    時限を全選択
                                </Button>
                                {CustomPeriodsGrid && (
                                    <CustomPeriodsGrid
                                        groupedDates={{ [format(focusedDate, "yyyy-MM-dd")]: [] }}
                                        selectedPeriods={selectedPeriods}
                                        togglePeriod={(id) => {
                                            const [_, pId] = id.split("_P");
                                            toggleFocusedPeriod(Number(pId), "P");
                                        }}
                                        busyPeriodIds={busyPeriodIds}
                                    />
                                )}
                            </TabsContent>

                            {/* タブ3: 繰り返し */}
                            <TabsContent value="recur" className="mt-0 space-y-2">
                                <p className="text-[10px] text-muted-foreground leading-snug">
                                    この日に選んだ時間帯を、未来の同曜日・同日付に複製します。
                                </p>
                                <div className="flex items-center gap-1.5">
                                    <select
                                        value={recurrencePeriod}
                                        onChange={(e) => setRecurrencePeriod(e.target.value as "weekly" | "biweekly" | "monthly")}
                                        className="h-9 rounded-md border bg-background px-2 text-xs flex-1"
                                        aria-label="繰り返しパターン"
                                    >
                                        <option value="weekly">毎週</option>
                                        <option value="biweekly">隔週</option>
                                        <option value="monthly">月次</option>
                                    </select>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={52}
                                        value={recurrenceCount}
                                        onChange={(e) => setRecurrenceCount(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
                                        className="h-9 w-16 text-sm tabular-nums"
                                        aria-label="繰り返し回数"
                                    />
                                    <span className="text-xs text-muted-foreground">回</span>
                                </div>
                                <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    className="w-full h-9 text-xs"
                                    onClick={applyRecurrence}
                                >
                                    繰り返し追加
                                </Button>
                            </TabsContent>
                        </Tabs>
                    </div>
                )}
            </div>

            {/* Right Main Area: Timeline */}
            <div className="flex-1 min-w-0 rounded-md border bg-background shadow-sm flex flex-col min-h-0 relative h-full overflow-hidden">

                <ScrollArea className="flex-1 w-full h-full overscroll-contain">
                    {/* Horizontal Scroll Wrapper */}
                    <div className="min-w-full w-fit">
                        {/* 1. Header Row (Sticky Top) */}
                        <div className="sticky top-0 z-40 flex border-b bg-background w-full">
                            {/* Corner Spacer (Sticky Left) */}
                            <div className="sticky left-0 z-50 w-12 flex-shrink-0 border-r bg-background" />

                            {/* Date Headers Container */}
                            <div className="flex flex-1 min-w-0">
                                {viewDates.length === 0 ? (
                                    <div className="flex-1 p-4 text-sm text-muted-foreground italic whitespace-nowrap">
                                        日付が選択されていません
                                    </div>
                                ) : (
                                    viewDates.map(date => {
                                        const isFocused = focusedDate?.getTime() === date.getTime();
                                        return (
                                            <div
                                                key={date.toISOString()}
                                                onClick={() => setFocusedDate(date)}
                                                className={cn(
                                                    "flex-none border-r w-[120px] flex flex-col items-center justify-center p-1 cursor-pointer transition-colors relative h-16 group/header",
                                                    isFocused
                                                        ? "bg-primary/10 text-primary border-b-2 border-b-primary"
                                                        : "bg-background/50 hover:bg-muted/50 text-muted-foreground"
                                                )}
                                            >
                                                <span className="text-xs uppercase">{format(date, "E", { locale: ja })}</span>
                                                <span className={cn("text-sm font-bold", isFocused && "text-primary")}>{format(date, "M/d", { locale: ja })}</span>

                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="absolute top-1 right-1 w-6 h-6 opacity-100"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyDaySelections(format(date, "yyyy-MM-dd"));
                                                    }}
                                                    title="この日の選択を他の日にコピー"
                                                >
                                                    <Copy className="w-3 h-3 text-primary" />
                                                </Button>
                                            </div>
                                        )
                                    })
                                )}
                                {/* Final Column Buffer for Side Tab */}
                                <div className="flex-none w-12 border-transparent" />
                            </div>
                        </div>

                        {/* 2. Timeline Body */}
                        <div
                            className="flex relative w-full"
                            style={{ height: `${(END_HOUR - START_HOUR) * 60 * PIXELS_PER_MINUTE}px` }}
                        >
                            {/* Time Axis (Sticky Left) */}
                            <div className="sticky left-0 z-30 w-12 flex-shrink-0 border-r bg-background">
                                {renderTimeAxis()}
                            </div>

                            {/* Grid & Columns */}
                            <div className="flex flex-1 min-w-0">
                                {renderGridLines()}

                                {viewDates.map(date => {
                                    const dateStr = format(date, "yyyy-MM-dd");
                                    const isFocused = focusedDate?.getTime() === date.getTime();

                                    return (
                                        <div
                                            key={dateStr}
                                            onClick={() => setFocusedDate(date)}
                                            className={cn(
                                                "flex-none border-r w-[120px] relative group/col transition-colors",
                                                isFocused ? "bg-primary/5" : ""
                                            )}
                                        >
                                            {/* Hover effect for column */}
                                            <div className={cn(
                                                "absolute inset-0 bg-transparent pointer-events-none transition-colors",
                                                !isFocused && "group-hover/col:bg-muted/10"
                                            )} />

                                            {/* 1. Render Busy Periods */}
                                            {(() => {
                                                const dayBusy = busyEvents
                                                    .filter(ev => format(new Date(ev.start), "yyyy-MM-dd") === dateStr)
                                                    .map(ev => ({
                                                        startMin: new Date(ev.start).getHours() * 60 + new Date(ev.start).getMinutes(),
                                                        endMin: (() => {
                                                            const s = new Date(ev.start);
                                                            const e = new Date(ev.end);
                                                            let m = e.getHours() * 60 + e.getMinutes();
                                                            if (m <= (s.getHours() * 60 + s.getMinutes()) && e.getDate() !== s.getDate()) m = 1440;
                                                            return m;
                                                        })(),
                                                        summary: ev.summary
                                                    }))
                                                    .sort((a, b) => a.startMin - b.startMin);

                                                const merged: typeof dayBusy = [];
                                                dayBusy.forEach(curr => {
                                                    const prev = merged[merged.length - 1];
                                                    if (prev && prev.summary === curr.summary && curr.startMin <= prev.endMin) {
                                                        prev.endMin = Math.max(prev.endMin, curr.endMin);
                                                    } else {
                                                        merged.push({ ...curr });
                                                    }
                                                });

                                                return merged.map((ev, i) => {
                                                    const style = getBlockStyle(ev.startMin, ev.endMin);
                                                    return (
                                                        <div
                                                            key={`busy-${i}`}
                                                            className="absolute inset-x-1 rounded px-1 py-0.5 text-xs font-bold border overflow-hidden flex items-center justify-center
                                                                       bg-red-100/60 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200/50 dark:border-red-800/50 z-10 pointer-events-none"
                                                            style={style}
                                                            title={ev.summary}
                                                        >
                                                            <span className="truncate w-full text-center opacity-70">
                                                                {ev.summary}
                                                            </span>
                                                        </div>
                                                    );
                                                });
                                            })()}

                                            {/* 2. Render Selected Periods (Foreground) */}
                                            {selectedPeriods.filter(p => p.startsWith(dateStr)).map(sp => {
                                                const [_, slot] = sp.split("_");
                                                const type = slot.startsWith("P") ? "P" : "H";
                                                const id = parseInt(slot.replace(/[PH]/, ""));
                                                const info = getSlotInfo(type, id);
                                                if (!info) return null;

                                                const style = getBlockStyle(info.startMin, info.endMin);
                                                const isConflict = busyPeriodIds.some(bp => {
                                                    if (!bp.startsWith(dateStr)) return false;
                                                    const [, bSlot] = bp.split("_");
                                                    const bType = bSlot.startsWith("P") ? "P" : "H";
                                                    const bId = parseInt(bSlot.replace(/[PH]/, ""));
                                                    const bInfo = getSlotInfo(bType, bId);
                                                    if (!bInfo) return false;
                                                    return bInfo.startMin < info.endMin && bInfo.endMin > info.startMin;
                                                });

                                                return (
                                                    <div
                                                        key={sp}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            togglePeriod(dateStr, id, type);
                                                        }}
                                                        title={isConflict ? "既存の予定と重複しています" : undefined}
                                                        className={cn(
                                                            "absolute inset-x-1 rounded px-2 py-1 text-[10px] sm:text-xs font-medium cursor-pointer shadow-sm hover:shadow-md transition-all z-20 overflow-hidden",
                                                            isConflict
                                                                ? "bg-primary text-primary-foreground border-2 border-red-500 dark:border-red-400 ring-2 ring-red-500/40"
                                                                : "bg-primary text-primary-foreground border border-primary"
                                                        )}
                                                        style={{
                                                            ...style,
                                                            ...(isConflict && {
                                                                backgroundImage: "repeating-linear-gradient(45deg, rgba(220,38,38,0.65) 0 6px, transparent 6px 14px)",
                                                            }),
                                                        }}
                                                    >
                                                        <div className="flex justify-between items-start">
                                                            <span>{info.sub}</span>
                                                            {isConflict ? (
                                                                <AlertTriangle className="w-3 h-3 text-red-100 dark:text-red-200 drop-shadow" />
                                                            ) : (
                                                                <X className="w-3 h-3 opacity-50 hover:opacity-100" />
                                                            )}
                                                        </div>
                                                        <div className="font-bold flex items-center gap-1">
                                                            {info.label}
                                                            {isConflict && (
                                                                <span className="text-[9px] font-semibold uppercase tracking-tight bg-red-600 text-white px-1 rounded">重複</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* 3. Invisible click areas for periods (Snap targets) - ONLY IF FOCUSED */}
                                            {isFocused && (
                                                <>
                                                    {CUSTOM_PERIODS.map(p => {
                                                        const info = getSlotInfo("P", p.id);
                                                        if (!info) return null;
                                                        const style = getBlockStyle(info.startMin, info.endMin);
                                                        return (
                                                            <div
                                                                key={`target-P${p.id}`}
                                                                className="absolute inset-x-0 z-0 hover:bg-primary/5 cursor-pointer"
                                                                style={style}
                                                                onClick={(e) => {
                                                                    e.stopPropagation(); // Stop bubbling to column click
                                                                    togglePeriod(dateStr, p.id, "P");
                                                                }}
                                                                title={`${p.label}を切り替え`}
                                                            />
                                                        );
                                                    })}
                                                    {HOURLY_SLOTS.map(h => {
                                                        const info = getSlotInfo("H", h.id);
                                                        if (!info) return null;
                                                        const style = getBlockStyle(info.startMin, info.endMin);
                                                        return (
                                                            <div
                                                                key={`target-H${h.id}`}
                                                                className="absolute inset-x-0 z-0 hover:bg-primary/5 cursor-pointer"
                                                                style={style}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    togglePeriod(dateStr, h.id, "H");
                                                                }}
                                                                title={`${h.id}:00を切り替え`}
                                                            />
                                                        );
                                                    })}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                {/* Legend / Info Footer */}
                <div className="border-t bg-muted/20 p-2 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-muted-foreground">
                    <div className="text-center sm:text-left">
                        空いている場所をクリックして時限を選択。時間指定は左のメニューから。
                        <span className="mx-2 inline-block w-3 h-3 bg-primary rounded align-middle"></span> 選択中
                        <span className="mx-2 inline-block w-3 h-3 bg-red-100 border border-red-200 dark:bg-red-900/20 rounded align-middle"></span> 予定あり
                        <span className="mx-2 inline-block w-3 h-3 bg-primary border-2 border-red-500 rounded align-middle"></span> 重複
                    </div>
                    {/* Zoom Controls */}
                    <div className="flex items-center gap-1 bg-background border rounded-md p-0.5 shadow-sm shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-sm"
                            onClick={() => setZoomLevel(z => Math.max(0.4, z - 0.2))}
                            disabled={zoomLevel <= 0.4}
                            title="縮小"
                        >
                            <ZoomOut className="w-4 h-4" />
                        </Button>
                        <span className="text-xs w-8 text-center font-medium">
                            {Math.round(zoomLevel * 100 / 1.2)}%
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-sm"
                            onClick={() => setZoomLevel(z => Math.min(3.0, z + 0.2))}
                            disabled={zoomLevel >= 3.0}
                            title="拡大"
                        >
                            <ZoomIn className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
