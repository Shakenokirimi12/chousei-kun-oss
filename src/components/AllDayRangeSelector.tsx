"use client";

import * as React from "react";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseCandidateDate } from "@/lib/candidates";

/** 終日候補の日数上限。回答画面のリストが実用的な範囲に収まるように制限する。 */
export const MAX_ALL_DAY_CANDIDATES = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

function toCandidate(date: Date): string {
    return `${format(date, "yyyy-MM-dd")}_D`;
}

/** [from, to] の各日を終日候補文字列にする。 */
function rangeToCandidates(from: Date, to: Date): string[] {
    const result: string[] = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    while (cursor <= end) {
        result.push(toCandidate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return result;
}

/**
 * 「日毎の出欠確認（終日）」の候補選択。開始日〜終了日をカレンダーで範囲選択し、
 * 範囲内の各日をチップとして表示する。チップをクリックすると個別に除外/復帰できる
 * （週末だけ外す、など）。
 *
 * selected は `YYYY-MM-DD_D` 形式の候補文字列。範囲そのものは保存せず、
 * 選択中候補の最小日〜最大日から復元する（下書き復元でも成立する）。
 */
export function AllDayRangeSelector({
    selected,
    onChange,
}: {
    selected: string[];
    onChange: (next: string[]) => void;
}) {
    const [rangeError, setRangeError] = React.useState<string | null>(null);
    // 上限超過で選択を拒否した際、カレンダー内部の一時的な表示状態が
    // 直前の(却下された)選択のまま残らないよう、key変更で強制的に作り直す。
    const [calendarResetKey, setCalendarResetKey] = React.useState(0);

    // 選択中候補から表示用の範囲(最小日〜最大日)を導出する
    const selectedDates = React.useMemo(
        () =>
            selected
                .map(parseCandidateDate)
                .filter((d): d is Date => d !== null)
                .sort((a, b) => a.getTime() - b.getTime()),
        [selected]
    );
    const rangeStart = selectedDates[0];
    const rangeEnd = selectedDates[selectedDates.length - 1];

    const calendarRange: DateRange | undefined = rangeStart
        ? { from: rangeStart, to: rangeEnd }
        : undefined;

    const handleRangeSelect = (range: DateRange | undefined) => {
        setRangeError(null);
        if (!range?.from) {
            onChange([]);
            return;
        }
        const to = range.to ?? range.from;
        const dayCount = Math.round((to.getTime() - range.from.getTime()) / DAY_MS) + 1;
        if (dayCount > MAX_ALL_DAY_CANDIDATES) {
            setRangeError(
                `選択した${dayCount}日は上限を超えています。${MAX_ALL_DAY_CANDIDATES}日以内になるよう選び直してください（この選択は反映されていません）。`
            );
            // カレンダー内部の表示を直前の有効な選択に強制的に巻き戻す
            setCalendarResetKey((k) => k + 1);
            return;
        }
        onChange(rangeToCandidates(range.from, to));
    };

    // 範囲内の全日をチップとして描画（除外済みの日は薄く表示し、クリックで復帰）
    const chipDays = React.useMemo(() => {
        if (!rangeStart || !rangeEnd) return [];
        const selectedSet = new Set(selected);
        return rangeToCandidates(rangeStart, rangeEnd).map((candidate) => ({
            candidate,
            date: parseCandidateDate(candidate)!,
            active: selectedSet.has(candidate),
        }));
    }, [rangeStart, rangeEnd, selected]);

    const toggleDay = (candidate: string, active: boolean) => {
        if (active) {
            // 全日除外は不可（候補0件のイベントは作れない）
            if (selected.length <= 1) return;
            onChange(selected.filter((c) => c !== candidate));
        } else {
            onChange([...selected, candidate].sort());
        }
    };

    // チップを週単位（日〜土）のグリッドに整形する。長期間の選択（30日超）でも
    // カレンダーと同じ見た目でスキャンでき、フラットなチップの壁にならないようにする。
    const weeks = React.useMemo(() => {
        if (chipDays.length === 0) return [];
        const result: (typeof chipDays[number] | null)[][] = [];
        let currentWeek: (typeof chipDays[number] | null)[] = [];
        const firstWeekday = chipDays[0].date.getDay();
        for (let i = 0; i < firstWeekday; i++) currentWeek.push(null);
        chipDays.forEach((chip) => {
            currentWeek.push(chip);
            if (currentWeek.length === 7) {
                result.push(currentWeek);
                currentWeek = [];
            }
        });
        if (currentWeek.length > 0) {
            while (currentWeek.length < 7) currentWeek.push(null);
            result.push(currentWeek);
        }
        return result;
    }, [chipDays]);

    const hasActiveWeekend = chipDays.some(({ date, active }) => active && (date.getDay() === 0 || date.getDay() === 6));
    const toggleAllWeekends = () => {
        const weekendCandidates = new Set(
            chipDays.filter(({ date }) => date.getDay() === 0 || date.getDay() === 6).map((c) => c.candidate)
        );
        if (hasActiveWeekend) {
            const next = selected.filter((c) => !weekendCandidates.has(c));
            if (next.length === 0) return; // 全日除外は不可
            onChange(next);
        } else {
            onChange([...new Set([...selected, ...weekendCandidates])].sort());
        }
    };

    return (
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 h-full w-full overflow-hidden p-3">
            <div className="flex-none w-full md:w-72 shrink-0">
                <div className="rounded-md border bg-card p-3 shadow-sm">
                    <h3 className="font-semibold text-sm mb-3 px-2">期間を選択</h3>
                    <Calendar
                        key={calendarResetKey}
                        mode="range"
                        selected={calendarRange}
                        onSelect={handleRangeSelect}
                        className="rounded-md border bg-background"
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        locale={ja}
                    />
                    <p className="text-xs text-muted-foreground mt-2 px-2">
                        開始日と終了日を選ぶと、その間の毎日が候補になります（最大{MAX_ALL_DAY_CANDIDATES}日）。
                    </p>
                    {rangeError && (
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mt-1 px-2 py-1.5 rounded bg-red-500/10 border border-red-200/50">
                            {rangeError}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {chipDays.length === 0 ? (
                    <div className="rounded-md border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                        カレンダーで期間を選択してください
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <p className="text-xs text-muted-foreground">
                                候補にしない日はクリックで除外できます（{selected.length}日選択中）
                            </p>
                            {chipDays.some((c) => c.date.getDay() === 0 || c.date.getDay() === 6) && (
                                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={toggleAllWeekends}>
                                    {hasActiveWeekend ? "土日をまとめて除外" : "土日を候補に戻す"}
                                </Button>
                            )}
                        </div>
                        {/* 週単位のグリッド表示（カレンダーと同じ並びでスキャンしやすくする） */}
                        <div className="space-y-1">
                            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
                                {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
                                    <div key={w} className={cn(i === 0 && "text-red-500", i === 6 && "text-blue-500")}>{w}</div>
                                ))}
                            </div>
                            {(() => {
                                let lastMonth = -1;
                                return weeks.map((week, wi) => {
                                    const firstChip = week.find((c): c is NonNullable<typeof c> => c !== null);
                                    const showMonthLabel = firstChip && firstChip.date.getMonth() !== lastMonth;
                                    if (firstChip) lastMonth = firstChip.date.getMonth();
                                    return (
                                        <div key={wi}>
                                            {showMonthLabel && firstChip && (
                                                <p className="text-xs font-semibold text-foreground mt-2 mb-1">
                                                    {format(firstChip.date, "yyyy年M月", { locale: ja })}
                                                </p>
                                            )}
                                            <div className="grid grid-cols-7 gap-1">
                                                {week.map((chip, di) => {
                                                    if (!chip) return <div key={di} />;
                                                    const { candidate, date, active } = chip;
                                                    return (
                                                        <Button
                                                            key={candidate}
                                                            type="button"
                                                            variant={active ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => toggleDay(candidate, active)}
                                                            className={cn(
                                                                "h-9 px-1 text-xs tabular-nums flex-col gap-0",
                                                                !active && "opacity-50 line-through"
                                                            )}
                                                        >
                                                            {format(date, "d", { locale: ja })}
                                                        </Button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
