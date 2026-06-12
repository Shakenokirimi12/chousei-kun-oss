"use client";

import { memo, useState, useRef, useMemo, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Triangle, Circle, ZoomIn, ZoomOut } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { CUSTOM_PERIODS, HOURLY_SLOTS } from "./PeriodSelector";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface AvailabilityTimelineProps {
    candidates: string[];
    availabilities: number[]; // 0=X, 1=Tri, 2=O
    onStatusChange: (idx: number, status: number) => void;
    onDayStatusChange?: (dateStr: string, status: number) => void;
    busyEvents?: { start: string; end: string; summary: string }[];
    okCounts?: number[];
    mode?: "response" | "admin" | "results";
    confirmedCandidateIdx?: number | null;
    candidateStats?: { ok: number; maybe: number; ng: number }[];
    candidateParticipants?: { ok: string[]; maybe: string[]; ng: string[] }[];
    onConfirmCandidate?: (idx: number) => void;
}

const parseTimeToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.trim().split(":").map(Number);
    return h * 60 + m;
};

// タイムラインに余白として確保する前後の時間（分）
const RANGE_PADDING_MIN = 60;
// 候補が無いときのフォールバック表示範囲
const FALLBACK_START_HOUR = 8;
const FALLBACK_END_HOUR = 20;

const getSlotInfo = (type: "P" | "H", id: number) => {
    if (type === "P") {
        const p = CUSTOM_PERIODS.find((x) => x.id === id);
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

const getBlockStyle = (startMin: number, endMin: number, zoomLevel: number, viewStartMin: number) => {
    const top = (startMin - viewStartMin) * zoomLevel;
    const height = (endMin - startMin) * zoomLevel;
    return { top: `${top}px`, height: `${height}px` };
};

export const AvailabilityTimeline = memo(function AvailabilityTimeline({
    candidates,
    availabilities,
    onStatusChange,
    onDayStatusChange,
    busyEvents = [],
    okCounts = [],
    mode = "response",
    confirmedCandidateIdx = null,
    candidateStats = [],
    candidateParticipants = [],
    onConfirmCandidate
}: AvailabilityTimelineProps) {
    const [focusedDate, setFocusedDate] = useState<Date | null>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [zoomLevel, setZoomLevel] = useState(2.2);
    const [selectedParticipantView, setSelectedParticipantView] = useState<{
        candidateIdx: number;
        status: "ok" | "maybe" | "ng";
    } | null>(null);
    const candidateScores = useMemo(
        () => candidateStats.map((s) => s.ok * 2 + s.maybe),
        [candidateStats]
    );
    const maxScore = useMemo(
        () => (candidateScores.length > 0 ? Math.max(...candidateScores) : 0),
        [candidateScores]
    );

    useEffect(() => {
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

    // 候補が収まる時間帯だけを表示する（0〜24時の全描画をやめ、空白を削減）。
    const { viewStartMin, viewEndMin } = useMemo(() => {
        let minStart = 1440;
        let maxEnd = 0;
        candidates.forEach(c => {
            const [, slot] = c.split("_");
            const type = slot.startsWith("P") ? "P" : "H";
            const id = parseInt(slot.replace(/[PH]/, ""), 10);
            const info = getSlotInfo(type, id);
            if (info) {
                if (info.startMin < minStart) minStart = info.startMin;
                if (info.endMin > maxEnd) maxEnd = info.endMin;
            }
        });
        if (minStart === 1440 || maxEnd === 0) {
            return { viewStartMin: FALLBACK_START_HOUR * 60, viewEndMin: FALLBACK_END_HOUR * 60 };
        }
        // 前後に余白を取り、時間境界(正時)に丸める
        const startHour = Math.max(0, Math.floor((minStart - RANGE_PADDING_MIN) / 60));
        const endHour = Math.min(24, Math.ceil((maxEnd + RANGE_PADDING_MIN) / 60));
        return { viewStartMin: startHour * 60, viewEndMin: endHour * 60 };
    }, [candidates]);

    const totalMinutes = viewEndMin - viewStartMin;
    const startHour = Math.floor(viewStartMin / 60);
    const endHour = Math.ceil(viewEndMin / 60);

    const viewDates = useMemo(() => {
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

    // 予定(busyEvents)を日付ごとに前処理＆マージしておく。
    // availabilities の変化（出欠トグル）では再計算されないようにして、無駄な再計算を防ぐ。
    const busyByDate = useMemo(() => {
        const map = new Map<string, { startMin: number; endMin: number; summary: string }[]>();
        busyEvents.forEach(ev => {
            const s = new Date(ev.start);
            const e = new Date(ev.end);
            if (Number.isNaN(s.getTime())) return;
            const dateStr = format(s, "yyyy-MM-dd");
            const startMin = s.getHours() * 60 + s.getMinutes();
            let endMin = e.getHours() * 60 + e.getMinutes();
            if (endMin <= startMin && e.getDate() !== s.getDate()) endMin = 1440;
            const arr = map.get(dateStr) ?? [];
            arr.push({ startMin, endMin, summary: ev.summary });
            map.set(dateStr, arr);
        });
        // 同名・重複/連続する予定をマージ
        for (const [dateStr, arr] of map) {
            arr.sort((a, b) => a.startMin - b.startMin);
            const merged: typeof arr = [];
            arr.forEach(curr => {
                const prev = merged[merged.length - 1];
                if (prev && prev.summary === curr.summary && curr.startMin <= prev.endMin) {
                    prev.endMin = Math.max(prev.endMin, curr.endMin);
                } else {
                    merged.push({ ...curr });
                }
            });
            map.set(dateStr, merged);
        }
        return map;
    }, [busyEvents]);

    useEffect(() => {
        if (!focusedDate && viewDates.length > 0) {
            setFocusedDate(viewDates[0]);
        }
    }, [viewDates, focusedDate]);


    const renderStatusIcon = useCallback((status: number) => {
        switch (status) {
            case 0: return <X className="w-4 h-4 text-red-500" />;
            case 1: return <Triangle className="w-4 h-4 text-yellow-500" />;
            case 2: return <Circle className="w-4 h-4 text-green-500" />;
            default: return null;
        }
    }, []);
    const getCandidateDisplayText = useCallback((idx: number) => {
        const candidate = candidates[idx];
        if (!candidate) return "";
        const [datePart, slot] = candidate.split("_");
        const type = slot.startsWith("P") ? "P" : "H";
        const id = parseInt(slot.replace(/[PH]/, ""), 10);
        const info = getSlotInfo(type, id);
        const date = new Date(datePart);
        const dateLabel = Number.isNaN(date.getTime()) ? datePart : format(date, "M/d(E)", { locale: ja });
        return `${dateLabel} ${info?.label ?? ""} ${info?.sub ?? ""}`.trim();
    }, [candidates]);
    const selectedNames =
        selectedParticipantView
            ? (candidateParticipants[selectedParticipantView.candidateIdx]?.[selectedParticipantView.status] ?? [])
            : [];
    const selectedStatusLabel = selectedParticipantView
        ? selectedParticipantView.status === "ok"
            ? "○"
            : selectedParticipantView.status === "maybe"
                ? "△"
                : "×"
        : "";

    const renderTimeAxis = () => {
        const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
        return (
            <div className="relative w-12 flex-shrink-0 border-r bg-background/50 backdrop-blur z-20">
                {hours.map(h => (
                    <div
                        key={h}
                        className="absolute w-full text-right pr-2 text-xs text-muted-foreground -translate-y-1/2 border-t border-transparent"
                        style={{ top: `${(h * 60 - viewStartMin) * zoomLevel}px` }}
                    >
                        {h}:00
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="flex flex-col rounded-md border bg-background shadow-sm overflow-hidden h-[70vh] sm:h-[600px]">
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
                    <span className="text-xs w-8 text-center font-medium text-foreground">
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

            <ScrollArea ref={viewportRef} className="flex-1 min-h-0 w-full relative overscroll-contain">
                <div className="flex flex-col min-w-full pb-20">
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
                                        {mode === "response" ? (
                                            <div className="absolute top-0.5 right-0.5 flex gap-1 opacity-100">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onDayStatusChange?.(dateStr, 2);
                                                    }}
                                                    className="w-5 h-5 rounded-full border border-green-400/60 bg-green-100 text-green-600 hover:bg-green-600 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
                                                    title="この日のすべてを○にする"
                                                    aria-label="この日のすべてを参加可能(○)にする"
                                                >
                                                    <Circle className="w-3 h-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onDayStatusChange?.(dateStr, 0);
                                                    }}
                                                    className="w-5 h-5 rounded-full border border-red-400/60 bg-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
                                                    title="この日のすべてを×にする"
                                                    aria-label="この日のすべてを不参加(×)にする"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ) : null}
                                        <span className="text-xs uppercase leading-none">{format(date, "E", { locale: ja })}</span>
                                        <span className="text-sm font-bold leading-none mt-0.5">{format(date, "M/d", { locale: ja })}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Timeline Body */}
                    <div className="flex relative min-w-max" style={{ height: `${totalMinutes * zoomLevel}px` }}>
                        <div className="sticky left-0 z-30 w-12 flex-shrink-0 border-r bg-background">
                            {renderTimeAxis()}
                        </div>

                        <div className="flex-1 flex relative">
                            {/* Grid Lines */}
                            <div className="absolute inset-0 pointer-events-none z-0">
                                {Array.from({ length: endHour - startHour + 1 }).map((_, h) => (
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
                                        {/* Busy Periods (precomputed & memoized per date) */}
                                        {(() => {
                                            const merged = busyByDate.get(dateStr) ?? [];

                                            return merged.map((ev, j) => {
                                                const style = getBlockStyle(ev.startMin, ev.endMin, zoomLevel, viewStartMin);
                                                return (
                                                    <div
                                                        key={`busy-${j}`}
                                                        className="absolute inset-x-1 rounded bg-red-100/50 dark:bg-red-900/20 border border-red-200/50 dark:border-red-800/30 z-10 pointer-events-none flex items-center justify-center overflow-hidden"
                                                        style={style}
                                                        title={ev.summary}
                                                    >
                                                        <span className="text-xs text-red-500 font-bold opacity-70 px-1 truncate w-full text-center">
                                                            {ev.summary}
                                                        </span>
                                                    </div>
                                                );
                                            });
                                        })()}

                                        {/* Candidate Blocks */}
                                        {candidates.map((c, idx) => {
                                            if (!c.startsWith(dateStr)) return null;
                                            const [_, slot] = c.split("_");
                                            const type = slot.startsWith("P") ? "P" : "H";
                                            const id = parseInt(slot.replace(/[PH]/, ""));
                                            const info = getSlotInfo(type, id);
                                            if (!info) return null;

                                            const status = availabilities[idx];
                                            const style = getBlockStyle(info.startMin, info.endMin, zoomLevel, viewStartMin);

                                            return (
                                                <div
                                                    key={idx}
                                                    className={cn(
                                                        "absolute inset-x-0.5 rounded border shadow-sm transition-all z-20 flex flex-col overflow-hidden group/block",
                                                        mode === "admin" || mode === "results"
                                                            ? "bg-card border-border/80"
                                                            : status === 2
                                                                ? "bg-green-500/10 border-green-500/50"
                                                                : status === 1
                                                                    ? "bg-yellow-500/10 border-yellow-500/50"
                                                                    : "bg-red-500/10 border-red-500/50",
                                                        confirmedCandidateIdx === idx ? "ring-2 ring-emerald-600 border-emerald-500" : "",
                                                        (mode === "admin" || mode === "results") &&
                                                            confirmedCandidateIdx !== idx &&
                                                            candidateScores[idx] === maxScore &&
                                                            maxScore > 0
                                                            ? "ring-2 ring-sky-500 border-sky-500"
                                                            : ""
                                                    )}
                                                    style={style}
                                                >
                                                    {/* Mobile Only: Tap to Cycle */}
                                                    {mode === "response" ? (
                                                        <div
                                                            role="button"
                                                            tabIndex={0}
                                                            aria-label={`${info.label} の出欠を切り替え`}
                                                            className="md:hidden absolute inset-0 z-30 cursor-pointer"
                                                            onClick={() => onStatusChange(idx, status === 2 ? 1 : status === 1 ? 0 : 2)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter" || e.key === " ") {
                                                                    e.preventDefault();
                                                                    onStatusChange(idx, status === 2 ? 1 : status === 1 ? 0 : 2);
                                                                }
                                                            }}
                                                        />
                                                    ) : null}

                                                    <div className="flex flex-col h-full p-1 relative z-10">
                                                        <div className="flex justify-between items-start mb-0.5">
                                                            <div className="flex flex-col leading-tight">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-xs font-bold opacity-70">{info.label}</span>
                                                                    {(mode === "admin" || mode === "results") &&
                                                                        confirmedCandidateIdx !== idx &&
                                                                        candidateScores[idx] === maxScore &&
                                                                        maxScore > 0 ? (
                                                                        <span className="text-xs bg-sky-100 text-sky-700 px-1 rounded-sm font-bold">
                                                                            推奨
                                                                        </span>
                                                                    ) : null}
                                                                    {(mode === "admin" || mode === "results") &&
                                                                        confirmedCandidateIdx === idx ? (
                                                                        <span className="text-xs bg-emerald-100 text-emerald-700 px-1 rounded-sm font-bold">
                                                                            確定
                                                                        </span>
                                                                    ) : null}
                                                                    {(okCounts[idx] || 0) > 0 && (
                                                                        <span className="text-xs bg-primary/20 text-primary px-1 rounded-sm font-bold">
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
                                                                <div className="grid grid-cols-3 gap-1 text-xs">
                                                                    <button
                                                                        type="button"
                                                                        className="rounded border border-green-400/50 bg-green-500/20 text-green-700 text-center py-1 hover:bg-green-500/35 transition-colors cursor-pointer"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedParticipantView({ candidateIdx: idx, status: "ok" });
                                                                        }}
                                                                        title="○を選択した参加者を見る"
                                                                    >
                                                                        ○ {candidateStats[idx]?.ok ?? 0}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="rounded border border-yellow-400/50 bg-yellow-500/20 text-yellow-700 text-center py-1 hover:bg-yellow-500/35 transition-colors cursor-pointer"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedParticipantView({ candidateIdx: idx, status: "maybe" });
                                                                        }}
                                                                        title="△を選択した参加者を見る"
                                                                    >
                                                                        △ {candidateStats[idx]?.maybe ?? 0}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="rounded border border-red-400/50 bg-red-500/20 text-red-700 text-center py-1 hover:bg-red-500/35 transition-colors cursor-pointer"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedParticipantView({ candidateIdx: idx, status: "ng" });
                                                                        }}
                                                                        title="×を選択した参加者を見る"
                                                                    >
                                                                        × {candidateStats[idx]?.ng ?? 0}
                                                                    </button>
                                                                </div>
                                                                {onConfirmCandidate ? (
                                                                    <button
                                                                        type="button"
                                                                        className={cn(
                                                                            "rounded text-xs py-1 px-2 font-semibold transition-colors self-end mt-auto",
                                                                            confirmedCandidateIdx === idx
                                                                                ? "bg-emerald-700 text-white"
                                                                                : "bg-foreground text-background hover:opacity-90"
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
                                                                            "rounded text-xs py-1 px-2 font-semibold text-center self-end mt-auto",
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
                                                                    aria-label="参加可能(○)"
                                                                    aria-pressed={status === 2}
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
                                                                    aria-label="調整中(△)"
                                                                    aria-pressed={status === 1}
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
                                                                    aria-label="不参加(×)"
                                                                    aria-pressed={status === 0}
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
            <Dialog open={selectedParticipantView !== null} onOpenChange={(open) => !open && setSelectedParticipantView(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {selectedStatusLabel} を選択した参加者
                        </DialogTitle>
                        <DialogDescription>
                            {selectedParticipantView ? getCandidateDisplayText(selectedParticipantView.candidateIdx) : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-64 overflow-y-auto text-sm">
                        {selectedNames.length > 0 ? (
                            <ul className="space-y-1">
                                {selectedNames.map((name, index) => (
                                    <li key={`${name}-${index}`} className="rounded border bg-muted/30 px-3 py-2">
                                        {name}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-muted-foreground">該当する参加者はいません。</p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
});
