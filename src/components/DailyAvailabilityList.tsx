"use client";

import { memo, useState, useMemo, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Triangle, Circle, CalendarClock, CalendarDays, List, CircleAlert } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatAllDayCandidateLabel, parseCandidateDate, allDayEventDateRange } from "@/lib/candidates";

/** 取り込んだ予定1件分の表示用情報（何の予定か・どのカレンダー由来か） */
type BusyDetail = { summary: string; source: string };

/**
 * 「日毎の出欠確認（終日候補）」用の回答/集計ビュー。
 * AvailabilityTimeline と同じ props 契約で、時間軸の代わりに日付ごとの行を表示する。
 * 呼び出し側は isAllDayEvent(candidates) で本コンポーネントと AvailabilityTimeline を出し分ける。
 */
interface DailyAvailabilityListProps {
    candidates: string[];
    availabilities: number[]; // 0=×, 1=△, 2=○
    onStatusChange: (idx: number, status: number) => void;
    busyEvents?: { start: string; end: string; summary: string; source?: string; allDay?: boolean }[];
    okCounts?: number[];
    mode?: "response" | "admin" | "results";
    confirmedCandidateIdx?: number | null;
    candidateStats?: { ok: number; maybe: number; ng: number }[];
    candidateParticipants?: { ok: string[]; maybe: string[]; ng: string[] }[];
    onConfirmCandidate?: (idx: number) => void;
}

export const DailyAvailabilityList = memo(function DailyAvailabilityList({
    candidates,
    availabilities,
    onStatusChange,
    busyEvents = [],
    okCounts = [],
    mode = "response",
    confirmedCandidateIdx = null,
    candidateStats = [],
    candidateParticipants = [],
    onConfirmCandidate,
}: DailyAvailabilityListProps) {
    const [selectedParticipantView, setSelectedParticipantView] = useState<{
        candidateIdx: number;
        status: "ok" | "maybe" | "ng";
    } | null>(null);
    // 「取り込んだ予定」ダイアログ: この日を×にした予定／参考程度の予定の内訳を見る
    const [selectedReasonIdx, setSelectedReasonIdx] = useState<number | null>(null);
    // カレンダー表示とリスト表示の切替（既定はカレンダー）
    const [view, setView] = useState<"calendar" | "list">("calendar");
    // カレンダーの「ブラシ」: 選択中の状態を日付のタップ/ドラッグで塗る。
    // 既定は ×（全日が○で始まるため、最初に塗るのは「いない日」が普通）。
    const [brush, setBrush] = useState<number>(0);

    // ドラッグ一括入力: ○/△/× ボタン（カレンダーではセル）を押したままなぞると、
    // 通過した日に同じ回答を連続適用する（タイムラインの一括操作の終日版）。
    const dragStatusRef = useRef<number | null>(null);
    const lastDragIdxRef = useRef<number | null>(null);

    const startDrag = (idx: number, status: number) => (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        // pointerdown の default を止めて click の二重発火とテキスト選択を防ぐ
        e.preventDefault();
        dragStatusRef.current = status;
        lastDragIdxRef.current = idx;
        onStatusChange(idx, status);
    };

    // カレンダーセル用: 選択中のブラシ状態を塗る。そのままドラッグすると
    // 通過したセルにも同じ状態を塗り広げる（ペイントツール方式）。
    const startCellDrag = (idx: number) => (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        dragStatusRef.current = brush;
        lastDragIdxRef.current = idx;
        onStatusChange(idx, brush);
    };

    useEffect(() => {
        if (mode !== "response") return;

        const handleMove = (e: PointerEvent) => {
            const status = dragStatusRef.current;
            if (status === null) return;
            const row = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest<HTMLElement>("[data-drag-idx]");
            if (!row) return;
            const idx = Number(row.dataset.dragIdx);
            if (!Number.isInteger(idx) || idx === lastDragIdxRef.current) return;
            lastDragIdxRef.current = idx;
            onStatusChange(idx, status);
        };
        const stopDrag = () => {
            dragStatusRef.current = null;
            lastDragIdxRef.current = null;
        };

        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", stopDrag);
        window.addEventListener("pointercancel", stopDrag);
        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", stopDrag);
            window.removeEventListener("pointercancel", stopDrag);
        };
    }, [mode, onStatusChange]);

    const candidateScores = useMemo(
        () => candidateStats.map((s) => s.ok * 2 + s.maybe),
        [candidateStats]
    );
    const maxScore = useMemo(
        () => (candidateScores.length > 0 ? Math.max(...candidateScores) : 0),
        [candidateScores]
    );

    // 日付ごとの取り込み済み予定を「この日を×にした予定（終日予定）」と
    // 「参考程度の予定（時間指定、自動×にはしない）」に分けて集計する。
    // 終日予定の対象日は allDayEventDateRange() で求める。これは回答フォーム
    // (ResponseForm) の自動×判定と全く同じロジックで、両者がズレて
    // 「実際には×になっていない日に×の理由が表示される」ことを防ぐ。
    const busyByDate = useMemo(() => {
        const map = new Map<string, { causing: BusyDetail[]; other: BusyDetail[] }>();
        const addTo = (bucket: "causing" | "other", dateStr: string, detail: BusyDetail) => {
            const entry = map.get(dateStr) ?? { causing: [], other: [] };
            if (!entry[bucket].some((d) => d.summary === detail.summary && d.source === detail.source)) {
                entry[bucket].push(detail);
            }
            map.set(dateStr, entry);
        };

        busyEvents.forEach((ev) => {
            const detail: BusyDetail = { summary: ev.summary, source: ev.source || "取り込んだ予定" };

            if (ev.allDay) {
                allDayEventDateRange(ev.start, ev.end).forEach((dateStr) => addTo("causing", dateStr, detail));
                return;
            }

            // 時間指定の予定は参考表示のみ（自動×にはしない）。複数日にまたがる場合は各日に計上する。
            const s = new Date(ev.start);
            const e = new Date(ev.end);
            if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;
            const cursor = new Date(s.getFullYear(), s.getMonth(), s.getDate());
            const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
            // 終了がちょうど0:00の場合は前日までの予定として扱う
            if (e.getHours() === 0 && e.getMinutes() === 0 && last > cursor) {
                last.setDate(last.getDate() - 1);
            }
            while (cursor <= last) {
                addTo("other", format(cursor, "yyyy-MM-dd"), detail);
                cursor.setDate(cursor.getDate() + 1);
            }
        });
        return map;
    }, [busyEvents]);

    const sortedIndices = useMemo(() => {
        return candidates
            .map((c, idx) => ({ c, idx }))
            .sort((a, b) => a.c.localeCompare(b.c))
            .map((x) => x.idx);
    }, [candidates]);

    // カレンダー表示用: 候補が属する月ごとに「日 → 候補idx」のマップを作る
    const months = useMemo(() => {
        const byMonth = new Map<string, { year: number; month: number; idxByDay: Map<number, number> }>();
        sortedIndices.forEach((idx) => {
            const date = parseCandidateDate(candidates[idx]);
            if (!date) return;
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            let entry = byMonth.get(key);
            if (!entry) {
                entry = { year: date.getFullYear(), month: date.getMonth(), idxByDay: new Map() };
                byMonth.set(key, entry);
            }
            entry.idxByDay.set(date.getDate(), idx);
        });
        return [...byMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month);
    }, [candidates, sortedIndices]);

    const renderStatusIcon = useCallback((status: number) => {
        switch (status) {
            case 0: return <X className="w-4 h-4 text-red-500" />;
            case 1: return <Triangle className="w-4 h-4 text-yellow-500" />;
            case 2: return <Circle className="w-4 h-4 text-green-500" />;
            default: return null;
        }
    }, []);

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

    const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

    return (
        <div className="flex flex-col rounded-md border bg-background shadow-sm overflow-hidden">
            <div className="border-b bg-muted/20 p-2 text-xs text-muted-foreground flex flex-col sm:flex-row items-center justify-between gap-2">
                <div className="text-center sm:text-left">
                    {mode === "admin" ? (
                        <span>日ごとの回答集計を見ながら「確定」ボタンで最終日を選択できます</span>
                    ) : mode === "results" ? (
                        <span>日ごとの回答集計（○/△/×）と確定済みの日を確認できます</span>
                    ) : view === "calendar" ? (
                        <span>下から ○/△/× を選んで、日付をタップ。押したままなぞると まとめて塗れます</span>
                    ) : (
                        <span>それぞれの日について ○（いる）/ △（未定）/ ×（いない）を選択してください（ボタンを押したまま上下になぞると連続入力できます）</span>
                    )}
                </div>
                <div className="flex items-center gap-0.5 bg-background border rounded-md p-0.5 shadow-sm shrink-0">
                    <button
                        type="button"
                        onClick={() => setView("calendar")}
                        aria-pressed={view === "calendar"}
                        className={cn(
                            "h-7 px-2 flex items-center gap-1 rounded-sm text-xs transition-colors",
                            view === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
                        )}
                    >
                        <CalendarDays className="w-3.5 h-3.5" />
                        カレンダー
                    </button>
                    <button
                        type="button"
                        onClick={() => setView("list")}
                        aria-pressed={view === "list"}
                        className={cn(
                            "h-7 px-2 flex items-center gap-1 rounded-sm text-xs transition-colors",
                            view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
                        )}
                    >
                        <List className="w-3.5 h-3.5" />
                        リスト
                    </button>
                </div>
            </div>

            {view === "calendar" && mode === "response" && (
                <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-2 sm:px-4 py-2 flex items-center justify-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">塗る状態:</span>
                    {[
                        { value: 2, label: "いる", icon: <Circle className="w-4 h-4" />, active: "bg-green-500 text-white border-green-500", idle: "text-green-600 dark:text-green-400 hover:bg-green-500/15" },
                        { value: 1, label: "未定", icon: <Triangle className="w-4 h-4" />, active: "bg-yellow-500 text-white border-yellow-500", idle: "text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/15" },
                        { value: 0, label: "いない", icon: <X className="w-4 h-4" />, active: "bg-red-500 text-white border-red-500", idle: "text-red-600 dark:text-red-400 hover:bg-red-500/15" },
                    ].map((b) => (
                        <button
                            key={b.value}
                            type="button"
                            onClick={() => setBrush(b.value)}
                            aria-pressed={brush === b.value}
                            className={cn(
                                "h-9 px-3 sm:px-4 flex items-center gap-1.5 rounded-md border font-bold text-sm transition-colors",
                                brush === b.value ? cn(b.active, "shadow-inner") : cn("border-border bg-background", b.idle)
                            )}
                        >
                            {b.icon}
                            {b.label}
                        </button>
                    ))}
                </div>
            )}

            {view === "calendar" && (
                <div className="p-2 sm:p-4 space-y-6">
                    {months.map(({ year, month, idxByDay }) => {
                        const leading = new Date(year, month, 1).getDay();
                        const daysInMonth = new Date(year, month + 1, 0).getDate();
                        const cells: (number | null)[] = [
                            ...Array<null>(leading).fill(null),
                            ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                        ];
                        while (cells.length % 7 !== 0) cells.push(null);

                        return (
                            <div key={`${year}-${month}`}>
                                <h3 className="text-sm sm:text-base font-bold mb-2 px-1">
                                    {year}年{month + 1}月
                                </h3>
                                <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                                    {WEEKDAYS.map((w, i) => (
                                        <div
                                            key={w}
                                            className={cn(
                                                "text-center text-xs font-medium py-1 text-muted-foreground",
                                                i === 0 && "text-red-500",
                                                i === 6 && "text-blue-500"
                                            )}
                                        >
                                            {w}
                                        </div>
                                    ))}
                                    {cells.map((day, i) => {
                                        if (day === null) {
                                            return <div key={`empty-${i}`} className="min-h-16 sm:min-h-24" />;
                                        }
                                        const idx = idxByDay.get(day);
                                        const weekday = i % 7;
                                        const dayNumberClass = cn(
                                            "text-xs sm:text-sm font-bold tabular-nums",
                                            weekday === 0 && "text-red-500",
                                            weekday === 6 && "text-blue-500"
                                        );

                                        // 候補でない日: 薄く日付だけ表示
                                        if (idx === undefined) {
                                            return (
                                                <div
                                                    key={`day-${i}`}
                                                    className="min-h-16 sm:min-h-24 rounded-md bg-muted/20 p-1.5 text-xs text-muted-foreground/40 tabular-nums"
                                                >
                                                    {day}
                                                </div>
                                            );
                                        }

                                        const candidate = candidates[idx];
                                        const dateStr = candidate.split("_")[0];
                                        const busyInfo = busyByDate.get(dateStr) ?? { causing: [], other: [] };
                                        const busyCount = busyInfo.causing.length + busyInfo.other.length;
                                        const isConfirmed = confirmedCandidateIdx === idx;
                                        const isRecommended =
                                            (mode === "admin" || mode === "results") &&
                                            !isConfirmed &&
                                            candidateScores[idx] === maxScore &&
                                            maxScore > 0;

                                        if (mode === "response") {
                                            const status = availabilities[idx];
                                            return (
                                                // ペイント操作(pointerdown)と「取り込んだ予定」ボタンを両立させるため
                                                // ネストしたinteractive要素を避け、セル本体はdiv+role="button"にする。
                                                <div
                                                    key={`day-${i}`}
                                                    role="button"
                                                    tabIndex={0}
                                                    data-drag-idx={idx}
                                                    onPointerDown={startCellDrag(idx)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault();
                                                            onStatusChange(idx, brush);
                                                        }
                                                    }}
                                                    aria-label={`${formatAllDayCandidateLabel(candidate)} を選択中の状態にする`}
                                                    className={cn(
                                                        "min-h-16 sm:min-h-24 rounded-md border p-1.5 flex flex-col items-stretch text-left touch-none select-none transition-colors cursor-pointer",
                                                        status === 2 && "bg-green-500/10 border-green-500/60 hover:bg-green-500/20",
                                                        status === 1 && "bg-yellow-500/10 border-yellow-500/60 hover:bg-yellow-500/20",
                                                        status === 0 && "bg-red-500/10 border-red-500/60 hover:bg-red-500/20"
                                                    )}
                                                >
                                                    <span className="flex items-center justify-between">
                                                        <span className={dayNumberClass}>{day}</span>
                                                        {busyCount > 0 && (
                                                            <button
                                                                type="button"
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedReasonIdx(idx);
                                                                }}
                                                                className={cn(
                                                                    "inline-flex items-center gap-0.5 text-[9px] rounded px-0.5 -m-0.5 touch-auto",
                                                                    busyInfo.causing.length > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                                                                )}
                                                                title="取り込んだ予定を見る"
                                                            >
                                                                {busyInfo.causing.length > 0 ? (
                                                                    <CircleAlert className="w-3 h-3" />
                                                                ) : (
                                                                    <CalendarClock className="w-3 h-3" />
                                                                )}
                                                                {busyCount}
                                                            </button>
                                                        )}
                                                    </span>
                                                    <span className="flex-1 flex items-center justify-center">
                                                        {status === 2 ? (
                                                            <Circle className="w-7 h-7 sm:w-10 sm:h-10 text-green-500" />
                                                        ) : status === 1 ? (
                                                            <Triangle className="w-7 h-7 sm:w-10 sm:h-10 text-yellow-500" />
                                                        ) : (
                                                            <X className="w-7 h-7 sm:w-10 sm:h-10 text-red-500" />
                                                        )}
                                                    </span>
                                                    {(okCounts[idx] || 0) > 0 && (
                                                        <span className="text-[9px] sm:text-[10px] text-primary font-bold leading-none">
                                                            {okCounts[idx]}人が○
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        }

                                        // admin / results: 集計 + 確定
                                        return (
                                            <div
                                                key={`day-${i}`}
                                                className={cn(
                                                    "min-h-20 sm:min-h-28 rounded-md border p-1.5 flex flex-col gap-1",
                                                    isConfirmed && "ring-2 ring-emerald-600 border-emerald-500 bg-emerald-500/5",
                                                    isRecommended && "ring-2 ring-sky-500 border-sky-500 bg-sky-500/5"
                                                )}
                                            >
                                                <span className="flex items-center justify-between gap-1">
                                                    <span className={dayNumberClass}>{day}</span>
                                                    {isConfirmed && (
                                                        <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1 rounded-sm font-bold whitespace-nowrap">確定</span>
                                                    )}
                                                    {isRecommended && (
                                                        <span className="text-[9px] bg-sky-100 text-sky-700 px-1 rounded-sm font-bold whitespace-nowrap">推奨</span>
                                                    )}
                                                </span>
                                                <div className="grid grid-cols-3 gap-0.5 text-[10px] sm:text-xs">
                                                    <button
                                                        type="button"
                                                        className="rounded border border-green-400/50 bg-green-500/20 text-green-700 text-center py-0.5 hover:bg-green-500/35 transition-colors cursor-pointer tabular-nums"
                                                        onClick={() => setSelectedParticipantView({ candidateIdx: idx, status: "ok" })}
                                                        title="○を選択した参加者を見る"
                                                    >
                                                        ○{candidateStats[idx]?.ok ?? 0}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="rounded border border-yellow-400/50 bg-yellow-500/20 text-yellow-700 text-center py-0.5 hover:bg-yellow-500/35 transition-colors cursor-pointer tabular-nums"
                                                        onClick={() => setSelectedParticipantView({ candidateIdx: idx, status: "maybe" })}
                                                        title="△を選択した参加者を見る"
                                                    >
                                                        △{candidateStats[idx]?.maybe ?? 0}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="rounded border border-red-400/50 bg-red-500/20 text-red-700 text-center py-0.5 hover:bg-red-500/35 transition-colors cursor-pointer tabular-nums"
                                                        onClick={() => setSelectedParticipantView({ candidateIdx: idx, status: "ng" })}
                                                        title="×を選択した参加者を見る"
                                                    >
                                                        ×{candidateStats[idx]?.ng ?? 0}
                                                    </button>
                                                </div>
                                                {onConfirmCandidate ? (
                                                    <button
                                                        type="button"
                                                        className={cn(
                                                            "mt-auto rounded text-[10px] sm:text-xs py-0.5 px-1 font-semibold transition-colors whitespace-nowrap",
                                                            isConfirmed
                                                                ? "bg-emerald-700 text-white"
                                                                : "bg-foreground text-background hover:opacity-90"
                                                        )}
                                                        onClick={() => onConfirmCandidate(idx)}
                                                    >
                                                        {isConfirmed ? "確定済み" : "確定"}
                                                    </button>
                                                ) : (
                                                    isConfirmed && (
                                                        <div className="mt-auto rounded text-[10px] sm:text-xs py-0.5 px-1 font-semibold text-center bg-emerald-600 text-white">
                                                            確定済み
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {view === "list" && (
            <div className="divide-y">
                {sortedIndices.map((idx) => {
                    const candidate = candidates[idx];
                    const date = parseCandidateDate(candidate);
                    const dateStr = candidate.split("_")[0];
                    const status = availabilities[idx];
                    const busyInfo = busyByDate.get(dateStr) ?? { causing: [], other: [] };
                    const isWeekend = date ? date.getDay() === 0 || date.getDay() === 6 : false;
                    const isConfirmed = confirmedCandidateIdx === idx;
                    const isRecommended =
                        (mode === "admin" || mode === "results") &&
                        !isConfirmed &&
                        candidateScores[idx] === maxScore &&
                        maxScore > 0;

                    return (
                        <div
                            key={candidate}
                            data-drag-idx={mode === "response" ? idx : undefined}
                            className={cn(
                                "flex items-center gap-2 sm:gap-3 px-3 py-2",
                                isConfirmed && "bg-emerald-500/10",
                                isRecommended && "bg-sky-500/5"
                            )}
                        >
                            {/* 日付ラベル */}
                            <div className="w-24 sm:w-28 shrink-0 flex flex-col leading-tight">
                                <span
                                    className={cn(
                                        "text-sm font-bold tabular-nums",
                                        date?.getDay() === 0 && "text-red-500",
                                        date?.getDay() === 6 && "text-blue-500"
                                    )}
                                >
                                    {formatAllDayCandidateLabel(candidate)}
                                </span>
                                <span className="flex items-center gap-1 flex-wrap">
                                    {isConfirmed && (
                                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded-sm font-bold">確定</span>
                                    )}
                                    {isRecommended && (
                                        <span className="text-[10px] bg-sky-100 text-sky-700 px-1 rounded-sm font-bold">推奨</span>
                                    )}
                                    {mode === "response" && (okCounts[idx] || 0) > 0 && (
                                        <span className="text-[10px] bg-primary/20 text-primary px-1 rounded-sm font-bold">
                                            {okCounts[idx]}人が○
                                        </span>
                                    )}
                                </span>
                            </div>

                            {/* 取り込み済み予定のバッジ。終日予定＝×の理由は赤、それ以外は参考として中立色で表示 */}
                            <div className="flex-1 min-w-0">
                                {busyInfo.causing.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedReasonIdx(idx)}
                                        className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-200/50 rounded px-1.5 py-0.5 max-w-full hover:bg-red-500/20 transition-colors"
                                        title={busyInfo.causing.map((d) => `${d.summary}（${d.source}）`).join("\n")}
                                    >
                                        <CircleAlert className="w-3 h-3 shrink-0" />
                                        <span className="truncate">
                                            ×の理由: {busyInfo.causing[0].summary}
                                            {busyInfo.causing.length > 1 ? ` 他${busyInfo.causing.length - 1}件` : ""}
                                        </span>
                                    </button>
                                )}
                                {busyInfo.causing.length === 0 && busyInfo.other.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedReasonIdx(idx)}
                                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/40 border rounded px-1.5 py-0.5 max-w-full hover:bg-muted transition-colors"
                                        title={busyInfo.other.map((d) => `${d.summary}（${d.source}）`).join("\n")}
                                    >
                                        <CalendarClock className="w-3 h-3 shrink-0" />
                                        <span className="truncate">予定 {busyInfo.other.length}件（参考）</span>
                                    </button>
                                )}
                            </div>

                            {mode === "admin" || mode === "results" ? (
                                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                    <div className="grid grid-cols-3 gap-1 text-xs">
                                        <button
                                            type="button"
                                            className="rounded border border-green-400/50 bg-green-500/20 text-green-700 text-center py-1 px-2 hover:bg-green-500/35 transition-colors cursor-pointer tabular-nums"
                                            onClick={() => setSelectedParticipantView({ candidateIdx: idx, status: "ok" })}
                                            title="○を選択した参加者を見る"
                                        >
                                            ○ {candidateStats[idx]?.ok ?? 0}
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded border border-yellow-400/50 bg-yellow-500/20 text-yellow-700 text-center py-1 px-2 hover:bg-yellow-500/35 transition-colors cursor-pointer tabular-nums"
                                            onClick={() => setSelectedParticipantView({ candidateIdx: idx, status: "maybe" })}
                                            title="△を選択した参加者を見る"
                                        >
                                            △ {candidateStats[idx]?.maybe ?? 0}
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded border border-red-400/50 bg-red-500/20 text-red-700 text-center py-1 px-2 hover:bg-red-500/35 transition-colors cursor-pointer tabular-nums"
                                            onClick={() => setSelectedParticipantView({ candidateIdx: idx, status: "ng" })}
                                            title="×を選択した参加者を見る"
                                        >
                                            × {candidateStats[idx]?.ng ?? 0}
                                        </button>
                                    </div>
                                    {onConfirmCandidate ? (
                                        <button
                                            type="button"
                                            className={cn(
                                                "rounded text-xs py-1 px-2 font-semibold transition-colors whitespace-nowrap",
                                                isConfirmed
                                                    ? "bg-emerald-700 text-white"
                                                    : "bg-foreground text-background hover:opacity-90"
                                            )}
                                            onClick={() => onConfirmCandidate(idx)}
                                        >
                                            {isConfirmed ? "確定済み" : "この日で確定"}
                                        </button>
                                    ) : (
                                        <div
                                            className={cn(
                                                "rounded text-xs py-1 px-2 font-semibold text-center whitespace-nowrap",
                                                isConfirmed ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                                            )}
                                        >
                                            {isConfirmed ? "確定済み" : "未確定"}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className="sm:hidden mr-1">{renderStatusIcon(status)}</span>
                                    <button
                                        type="button"
                                        onClick={() => onStatusChange(idx, 2)}
                                        onPointerDown={startDrag(idx, 2)}
                                        className={cn(
                                            "w-10 h-9 flex items-center justify-center rounded-md transition-colors border touch-none",
                                            status === 2
                                                ? "bg-green-500 text-white border-green-500 shadow-inner"
                                                : "border-border hover:bg-green-500/20 text-green-600 dark:text-green-400"
                                        )}
                                        title="いる"
                                        aria-label={`${formatAllDayCandidateLabel(candidate)} いる(○)`}
                                        aria-pressed={status === 2}
                                    >
                                        <Circle className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onStatusChange(idx, 1)}
                                        onPointerDown={startDrag(idx, 1)}
                                        className={cn(
                                            "w-10 h-9 flex items-center justify-center rounded-md transition-colors border touch-none",
                                            status === 1
                                                ? "bg-yellow-500 text-white border-yellow-500 shadow-inner"
                                                : "border-border hover:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
                                        )}
                                        title="未定"
                                        aria-label={`${formatAllDayCandidateLabel(candidate)} 未定(△)`}
                                        aria-pressed={status === 1}
                                    >
                                        <Triangle className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onStatusChange(idx, 0)}
                                        onPointerDown={startDrag(idx, 0)}
                                        className={cn(
                                            "w-10 h-9 flex items-center justify-center rounded-md transition-colors border touch-none",
                                            status === 0
                                                ? "bg-red-500 text-white border-red-500 shadow-inner"
                                                : "border-border hover:bg-red-500/20 text-red-600 dark:text-red-400"
                                        )}
                                        title="いない"
                                        aria-label={`${formatAllDayCandidateLabel(candidate)} いない(×)`}
                                        aria-pressed={status === 0}
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            )}

            <Dialog open={selectedParticipantView !== null} onOpenChange={(open) => !open && setSelectedParticipantView(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{selectedStatusLabel} を選択した参加者</DialogTitle>
                        <DialogDescription>
                            {selectedParticipantView !== null
                                ? `${formatAllDayCandidateLabel(candidates[selectedParticipantView.candidateIdx])} 終日`
                                : ""}
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

            <Dialog open={selectedReasonIdx !== null} onOpenChange={(open) => !open && setSelectedReasonIdx(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>取り込んだ予定</DialogTitle>
                        <DialogDescription>
                            {selectedReasonIdx !== null ? formatAllDayCandidateLabel(candidates[selectedReasonIdx]) : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-72 overflow-y-auto text-sm space-y-4">
                        {selectedReasonIdx !== null && (() => {
                            const dateStr = candidates[selectedReasonIdx].split("_")[0];
                            const info = busyByDate.get(dateStr) ?? { causing: [], other: [] };
                            if (info.causing.length === 0 && info.other.length === 0) {
                                return <p className="text-muted-foreground">取り込んだ予定はありません。</p>;
                            }
                            return (
                                <>
                                    {info.causing.length > 0 && (
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-red-600 dark:text-red-400">
                                                この日を×にした予定（終日予定）
                                            </p>
                                            <ul className="space-y-1">
                                                {info.causing.map((d, i) => (
                                                    <li key={i} className="rounded border border-red-200/60 bg-red-500/5 px-3 py-2">
                                                        <p className="font-medium">{d.summary}</p>
                                                        <p className="text-xs text-muted-foreground">{d.source}</p>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {info.other.length > 0 && (
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-muted-foreground">
                                                その他の取り込み済み予定（参考、×にはなりません）
                                            </p>
                                            <ul className="space-y-1">
                                                {info.other.map((d, i) => (
                                                    <li key={i} className="rounded border bg-muted/30 px-3 py-2">
                                                        <p className="font-medium">{d.summary}</p>
                                                        <p className="text-xs text-muted-foreground">{d.source}</p>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
});
