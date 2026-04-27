"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Triangle, Circle, ZoomIn, ZoomOut } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { CUSTOM_PERIODS, HOURLY_SLOTS } from "./PeriodSelector";

interface AvailabilityTimelineProps {
    candidates: string[];
    availabilities: number[]; // 0=X, 1=Tri, 2=O
    onStatusChange: (idx: number, status: number) => void;
    onDayStatusChange?: (dateStr: string, status: number) => void;
    busyPeriods?: string[]; // Format: "YYYY-MM-DD_P#" or "YYYY-MM-DD_H#"
    okCounts?: number[];
    mode?: "response" | "admin" | "results";
    confirmedCandidateIdx?: number | null;
    candidateStats?: { ok: number; maybe: number; ng: number }[];
    onConfirmCandidate?: (idx: number) => void;
}

const parseTimeToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.trim().split(":").map(Number);
    return h * 60 + m;
};

const START_HOUR = 0;
const END_HOUR = 24;
const START_MINUTES = START_HOUR * 60;

const getSlotInfo = (type: "P" | "H", id: number) => {
    if (type === "P") {
        const p = CUSTOM_PERIODS.find((x: any) => x.id === id);
        if (!p) return null;
        const [start, end] = p.time.split("-");
        return {
            startMin: parseTimeToMinutes(start),
            endMin: parseTimeToMinutes(end),
            label: `${p.id}限`,
            sub: p.time
        };
    } else {
        const h = HOURLY_SLOTS.find(x => x.id === id);
        if (!h) return null;
        const [start, end] = h.time.split("-");
        return {
            startMin: parseTimeToMinutes(start),
            endMin: parseTimeToMinutes(end),
            label: `${h.id}:00`,
            sub: "60分"
        };
    }
};

const getBlockStyle = (startMin: number, endMin: number, zoomLevel: number) => {
    const top = (startMin - START_MINUTES) * zoomLevel;
    const height = (endMin - startMin) * zoomLevel;
    return { top: `${top}px`, height: `${height}px` };
};

export function AvailabilityTimeline({
    candidates,
    availabilities,
    onStatusChange,
    onDayStatusChange,
    busyPeriods = [],
    okCounts = [],
    mode = "response",
    confirmedCandidateIdx = null,
    candidateStats = [],
    onConfirmCandidate
}: AvailabilityTimelineProps) {
    const [focusedDate, setFocusedDate] = React.useState<Date | null>(null);
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const [zoomLevel, setZoomLevel] = React.useState(1.2);

    React.useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const onWheel = (event: WheelEvent) => {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            const atTop = scrollTop <= 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

            // Prevent scroll chaining to the page when timeline hits top/bottom.
            if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
                event.preventDefault();
            }
        };

        viewport.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            viewport.removeEventListener("wheel", onWheel);
        };
    }, []);

    const earliestStartMin = React.useMemo(() => {
        if (candidates.length === 0) return 0;
        let min = 1440; // 24 hours
        candidates.forEach(c => {
            const [_, slot] = c.split("_");
            const type = slot.startsWith("P") ? "P" : "H";
            const id = parseInt(slot.replace(/[PH]/, ""));
            const info = getSlotInfo(type, id);
            if (info && info.startMin < min) {
                min = info.startMin;
            }
        });
        return min === 1440 ? 0 : min;
    }, [candidates]);

    React.useEffect(() => {
        if (viewportRef.current && earliestStartMin > 0) {
            const scrollPos = (earliestStartMin - START_MINUTES) * zoomLevel;
            // Slightly offset to show the header clearly
            viewportRef.current.scrollTop = Math.max(0, scrollPos - 20);
        }
    }, [earliestStartMin, zoomLevel]);

    const viewDates = React.useMemo(() => {
        const datesMap = new Map<string, Date>();
        candidates.forEach(c => {
            const dateStr = c.split("_")[0];
            if (!datesMap.has(dateStr)) {
                datesMap.set(dateStr, new Date(dateStr));
            }
        });
        const sorted = Array.from(datesMap.values()).sort((a, b) => a.getTime() - b.getTime());
        return sorted;
    }, [candidates]);

    React.useEffect(() => {
        if (!focusedDate && viewDates.length > 0) {
            setFocusedDate(viewDates[0]);
        }
    }, [viewDates, focusedDate]);


    const renderStatusIcon = (status: number) => {
        switch (status) {
            case 0: return <X className="w-4 h-4 text-red-500" />;
            case 1: return <Triangle className="w-4 h-4 text-yellow-500" />;
            case 2: return <Circle className="w-4 h-4 text-green-500" />;
            default: return null;
        }
    };

    const renderTimeAxis = () => {
        const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
        return (
            <div className="relative w-12 flex-shrink-0 border-r bg-background/50 backdrop-blur z-20">
                {hours.map(h => (
                    <div
                        key={h}
                        className="absolute w-full text-right pr-2 text-xs text-muted-foreground -translate-y-1/2 border-t border-transparent"
                        style={{ top: `${(h * 60 - START_MINUTES) * zoomLevel}px` }}
                    >
                        {h}:00
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="flex flex-col rounded-md border bg-background shadow-sm overflow-hidden h-[600px]">
            <div className="border-b bg-muted/20 p-2 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between items-center gap-2">
                <div className="text-center sm:text-left">
                    {mode === "admin" || mode === "results" ? (
                        <>
                            {mode === "admin" ? (
                                <>
                                    <span className="md:hidden">候補ブロックを確認して「確定」ボタンを押してください</span>
                                    <span className="hidden md:inline">回答集計を見ながら、候補ブロック内の「この候補で確定」ボタンで最終日程を選択できます</span>
                                </>
                            ) : (
                                <>
                                    <span className="md:hidden">候補ブロックごとの回答集計を確認できます</span>
                                    <span className="hidden md:inline">候補ブロックごとの回答集計（○/△/×）と確定済み候補を確認できます</span>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <span className="md:hidden">候補日程のブロックをタップすると「○ → △ → ×」が切り替わります</span>
                            <span className="hidden md:inline">候補日程内の記号（○ △ ×）をクリックして出欠を選択してください</span>
                        </>
                    )}
                </div>
                {/* Zoom Controls */}
                <div className="flex items-center gap-1 bg-background border rounded-md p-0.5 shadow-sm shrink-0">
                    <button
                        type="button"
                        className="h-7 w-7 flex items-center justify-center rounded-sm hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                        onClick={() => setZoomLevel(z => Math.max(0.4, z - 0.2))}
                        disabled={zoomLevel <= 0.4}
                        title="縮小"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] w-8 text-center font-medium text-foreground">
                        {Math.round(zoomLevel * 100 / 1.2)}%
                    </span>
                    <button
                        type="button"
                        className="h-7 w-7 flex items-center justify-center rounded-sm hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                        onClick={() => setZoomLevel(z => Math.min(3.0, z + 0.2))}
                        disabled={zoomLevel >= 3.0}
                        title="拡大"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <ScrollArea ref={viewportRef} className="flex-1 w-full h-full relative overscroll-contain">
                <div className="flex flex-col min-w-full inline-block pb-20">
                    {/* Header Row */}
                    <div className="sticky top-0 z-40 flex border-b bg-background w-full min-w-max">
                        <div className="sticky left-0 z-50 w-12 flex-shrink-0 border-r bg-background" />
                        <div className="flex flex-1">
                            {viewDates.map(date => {
                                const isFocused = focusedDate?.getTime() === date.getTime();
                                const dateStr = format(date, "yyyy-MM-dd");
                                return (
                                    <div
                                        key={date.toISOString()}
                                        onClick={() => setFocusedDate(date)}
                                        className={cn(
                                            "flex-1 border-r min-w-[100px] flex flex-col items-center justify-center p-1 cursor-pointer transition-colors relative h-12 group/header",
                                            isFocused ? "bg-primary/10 text-primary" : "bg-background hover:bg-muted/50"
                                        )}
                                    >
                                        <div className="absolute top-0.5 right-0.5 flex gap-1 md:opacity-0 md:group-hover/header:opacity-100 transition-opacity">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDayStatusChange?.(dateStr, 2);
                                                }}
                                                className="w-4 h-4 rounded-full bg-green-100 text-green-600 hover:bg-green-600 hover:text-white transition-colors flex items-center justify-center"
                                                title="この日のすべてを○にする"
                                            >
                                                <Circle className="w-2.5 h-2.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDayStatusChange?.(dateStr, 0);
                                                }}
                                                className="w-4 h-4 rounded-full bg-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center"
                                                title="この日のすべてを×にする"
                                            >
                                                <X className="w-2.5 h-2.5" />
                                            </button>
                                        </div>
                                        <span className="text-[10px] uppercase leading-none">{format(date, "E", { locale: ja })}</span>
                                        <span className="text-sm font-bold leading-none mt-0.5">{format(date, "M/d", { locale: ja })}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Timeline Body */}
                    <div className="flex relative min-w-max" style={{ height: `${(END_HOUR - START_HOUR) * 60 * zoomLevel}px` }}>
                        <div className="sticky left-0 z-30 w-12 flex-shrink-0 border-r bg-background">
                            {renderTimeAxis()}
                        </div>

                        <div className="flex-1 flex relative">
                            {/* Grid Lines */}
                            <div className="absolute inset-0 pointer-events-none z-0">
                                {Array.from({ length: 25 }).map((_, h) => (
                                    <div
                                        key={h}
                                        className="absolute w-full border-t border-border/40 dashed"
                                        style={{ top: `${(h * 60) * zoomLevel}px` }}
                                    />
                                ))}
                            </div>

                            {viewDates.map(date => {
                                const dateStr = format(date, "yyyy-MM-dd");
                                return (
                                    <div key={dateStr} className="flex-1 border-r relative min-w-[100px]">
                                        {/* Busy Periods */}
                                        {busyPeriods.filter(p => p.startsWith(dateStr)).map((bp, j) => {
                                            const [_, slot] = bp.split("_");
                                            const type = slot.startsWith("P") ? "P" : "H";
                                            const id = parseInt(slot.replace(/[PH]/, ""));
                                            const info = getSlotInfo(type, id);
                                            if (!info) return null;
                                            return (
                                                <div
                                                    key={`busy-${j}`}
                                                    className="absolute inset-x-1 rounded bg-red-100/50 dark:bg-red-900/10 border border-red-200/50 dark:border-red-800/20 z-10 pointer-events-none flex items-center justify-center"
                                                    style={getBlockStyle(info.startMin, info.endMin, zoomLevel)}
                                                >
                                                    <span className="text-[10px] text-red-400 font-bold opacity-30">予定あり</span>
                                                </div>
                                            );
                                        })}

                                        {/* Candidate Blocks */}
                                        {candidates.map((c, idx) => {
                                            if (!c.startsWith(dateStr)) return null;
                                            const [_, slot] = c.split("_");
                                            const type = slot.startsWith("P") ? "P" : "H";
                                            const id = parseInt(slot.replace(/[PH]/, ""));
                                            const info = getSlotInfo(type, id);
                                            if (!info) return null;

                                            const status = availabilities[idx];
                                            const style = getBlockStyle(info.startMin, info.endMin, zoomLevel);

                                            return (
                                                <div
                                                    key={idx}
                                                    className={cn(
                                                        "absolute inset-x-0.5 rounded border shadow-sm transition-all z-20 flex flex-col overflow-hidden group/block",
                                                        mode === "admin" && confirmedCandidateIdx === idx ? "ring-2 ring-emerald-500 bg-emerald-500/10 border-emerald-500/70" : "",
                                                        status === 2 ? "bg-green-500/10 border-green-500/50" :
                                                            status === 1 ? "bg-yellow-500/10 border-yellow-500/50" :
                                                                "bg-red-500/10 border-red-500/50"
                                                    )}
                                                    style={style}
                                                >
                                                    {/* Mobile Only: Tap to Cycle */}
                                                    {mode === "response" ? (
                                                        <div
                                                            className="md:hidden absolute inset-0 z-30 cursor-pointer"
                                                            onClick={() => onStatusChange(idx, status === 2 ? 1 : status === 1 ? 0 : 2)}
                                                        />
                                                    ) : null}

                                                    <div className="flex flex-col h-full p-1 relative z-10">
                                                        <div className="flex justify-between items-start mb-0.5">
                                                            <div className="flex flex-col leading-tight">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-[10px] font-bold opacity-70">{info.label}</span>
                                                                    {(okCounts[idx] || 0) > 0 && (
                                                                        <span className="text-[9px] bg-primary/20 text-primary px-1 rounded-sm font-bold">
                                                                            {(okCounts[idx] || 0)}人
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className="text-[8px] opacity-60 whitespace-nowrap">{info.sub}</span>
                                                            </div>
                                                            <div className="md:hidden">
                                                                {renderStatusIcon(status)}
                                                            </div>
                                                        </div>

                                                        {mode === "admin" || mode === "results" ? (
                                                            <div className="flex-1 flex flex-col justify-end gap-1">
                                                                <div className="grid grid-cols-3 gap-1 text-[9px]">
                                                                    <div className="rounded bg-green-500/20 text-green-700 text-center py-0.5">
                                                                        ○ {candidateStats[idx]?.ok ?? 0}
                                                                    </div>
                                                                    <div className="rounded bg-yellow-500/20 text-yellow-700 text-center py-0.5">
                                                                        △ {candidateStats[idx]?.maybe ?? 0}
                                                                    </div>
                                                                    <div className="rounded bg-red-500/20 text-red-700 text-center py-0.5">
                                                                        × {candidateStats[idx]?.ng ?? 0}
                                                                    </div>
                                                                </div>
                                                                {onConfirmCandidate ? (
                                                                    <button
                                                                        type="button"
                                                                        className={cn(
                                                                            "w-full rounded text-[10px] py-1 font-semibold transition-colors",
                                                                            confirmedCandidateIdx === idx
                                                                                ? "bg-emerald-600 text-white"
                                                                                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                                                        )}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            onConfirmCandidate?.(idx);
                                                                        }}
                                                                    >
                                                                        {confirmedCandidateIdx === idx ? "確定済み" : "この候補で確定"}
                                                                    </button>
                                                                ) : (
                                                                    <div
                                                                        className={cn(
                                                                            "w-full rounded text-[10px] py-1 font-semibold text-center",
                                                                            confirmedCandidateIdx === idx
                                                                                ? "bg-emerald-600 text-white"
                                                                                : "bg-muted text-muted-foreground"
                                                                        )}
                                                                    >
                                                                        {confirmedCandidateIdx === idx ? "確定済み候補" : "未確定"}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="hidden md:flex flex-1 items-center justify-around gap-0.5">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onStatusChange(idx, 2); }}
                                                                    className={cn(
                                                                        "flex-1 h-full max-h-8 flex items-center justify-center rounded-sm transition-colors border border-transparent",
                                                                        status === 2 ? "bg-green-500 text-white shadow-inner" : "hover:bg-green-500/20 text-green-600 dark:text-green-400"
                                                                    )}
                                                                    title="参加可能"
                                                                >
                                                                    <Circle className="w-3 h-3" />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onStatusChange(idx, 1); }}
                                                                    className={cn(
                                                                        "flex-1 h-full max-h-8 flex items-center justify-center rounded-sm transition-colors border border-transparent",
                                                                        status === 1 ? "bg-yellow-500 text-white shadow-inner" : "hover:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
                                                                    )}
                                                                    title="調整中"
                                                                >
                                                                    <Triangle className="w-3 h-3" />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onStatusChange(idx, 0); }}
                                                                    className={cn(
                                                                        "flex-1 h-full max-h-8 flex items-center justify-center rounded-sm transition-colors border border-transparent",
                                                                        status === 0 ? "bg-red-500 text-white shadow-inner" : "hover:bg-red-500/20 text-red-600 dark:text-red-400"
                                                                    )}
                                                                    title="不参加"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
