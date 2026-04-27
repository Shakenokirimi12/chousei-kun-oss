"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, Copy, ZoomIn, ZoomOut } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import dynamic from "next/dynamic";

import { CUSTOM_PERIODS } from "@/config/periods";

export { CUSTOM_PERIODS };

// Define the expected props for CustomPeriodsGrid
interface CustomPeriodsGridProps {
    groupedDates: Record<string, string[]>;
    selectedPeriods: string[];
    togglePeriod: (id: string) => void;
    busyPeriods?: string[];
}

// Dynamically import CustomPeriodsGrid only if CUSTOM_PERIODS is not empty
const CustomPeriodsGrid = CUSTOM_PERIODS.length > 0
    ? dynamic<CustomPeriodsGridProps>(() => import('@/components/CustomPeriodsGrid'), { ssr: false })
    : null; // Render nothing if CUSTOM_PERIODS is empty

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
    busyPeriods?: string[]; // Format: "YYYY-MM-DD_P#" or "YYYY-MM-DD_H#"
}

export function PeriodSelector({
    selectedPeriods,
    onChange,
    busyPeriods = []
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

    const selectDayAll = () => {
        if (!focusedDate) return;
        const dateStr = format(focusedDate, "yyyy-MM-dd");
        const allSlots = [
            ...CUSTOM_PERIODS.map(p => `${dateStr}_P${p.id}`),
            ...HOURLY_SLOTS.map(h => `${dateStr}_H${h.id}`)
        ];

        const otherDaysSelections = selectedPeriods.filter(p => !p.startsWith(dateStr));
        onChange([...otherDaysSelections, ...allSlots]);
    };

    const clearDayAll = () => {
        if (!focusedDate) return;
        const dateStr = format(focusedDate, "yyyy-MM-dd");
        onChange(selectedPeriods.filter(p => !p.startsWith(dateStr)));
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
            <div className="flex-none w-full md:w-72 flex flex-col gap-4 overflow-y-auto md:overflow-hidden min-h-0 md:h-full pb-4 md:pb-0 shrink-0 max-h-[40vh] md:max-h-none">
                <div className="rounded-md border bg-card p-3 shadow-sm shrink-0">
                    <h3 className="font-semibold text-sm mb-3 px-2">日付を選択</h3>
                    <Calendar
                        mode="multiple"
                        selected={viewDates}
                        onSelect={onSelectDates}
                        className="rounded-md border bg-background"
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                        locale={ja}
                    />
                </div>

                <div className="flex-1 rounded-md border bg-card p-3 shadow-sm flex flex-col min-h-0">
                    <h3 className="font-semibold text-sm mb-3 px-2 flex justify-between items-center">
                        <span>クイック選択</span>
                        {focusedDate && (
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[10px] text-primary"
                                    onClick={selectDayAll}
                                >
                                    全選択
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[10px] text-muted-foreground"
                                    onClick={clearDayAll}
                                >
                                    解除
                                </Button>
                                <span className="text-xs font-normal text-muted-foreground bg-accent px-2 py-0.5 rounded ml-1">
                                    {format(focusedDate, "M月d日", { locale: ja })}
                                </span>
                            </div>
                        )}
                    </h3>
                    <ScrollArea className="flex-1 pr-3">
                        <div className="space-y-2">
                            {!focusedDate ? (
                                <div className="text-sm text-muted-foreground text-center py-8">
                                    右側のカレンダーから日付を選択してください
                                </div>
                            ) : (
                                <>
                                    {CustomPeriodsGrid && (
                                        <CustomPeriodsGrid
                                            groupedDates={{ [format(focusedDate, "yyyy-MM-dd")]: [] }}
                                            selectedPeriods={selectedPeriods}
                                            togglePeriod={(id) => {
                                                const [_, pId] = id.split("_P");
                                                toggleFocusedPeriod(Number(pId), "P");
                                            }}
                                            busyPeriods={busyPeriods}
                                        />
                                    )}
                                    <div>
                                        <h4 className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-tight">時間 (1時間ごと)</h4>
                                        <div className="grid grid-cols-4 lg:grid-cols-6 gap-1">
                                            {HOURLY_SLOTS.map(h => {
                                                const isSelected = selectedPeriods.includes(
                                                    `${format(focusedDate, "yyyy-MM-dd")}_H${h.id}`
                                                );
                                                return (
                                                    <Button
                                                        key={h.id}
                                                        type="button"
                                                        variant={isSelected ? "default" : "outline"}
                                                        size="sm"
                                                        className="h-9 px-0 flex flex-col gap-0"
                                                        onClick={() => toggleFocusedPeriod(h.id, "H")}
                                                    >
                                                        <span className="text-[10px] leading-none">{h.id}:00</span>
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </div>

            {/* Right Main Area: Timeline */}
            <div className="flex-1 rounded-md border bg-background shadow-sm flex flex-col min-h-0 relative h-full">
                <ScrollArea className="flex-1 w-full h-full overscroll-contain">
                    {/* Container for the specific scroll content */}
                    <div className="flex flex-col min-w-full inline-block pb-48">

                        {/* 1. Header Row (Sticky Top) */}
                        <div className="sticky top-0 z-40 flex border-b bg-background w-full min-w-max">
                            {/* Corner Spacer (Sticky Left) */}
                            <div className="sticky left-0 z-50 w-12 flex-shrink-0 border-r bg-background" />

                            {/* Date Headers */}
                            <div className="flex flex-1">
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
                                                    "flex-1 border-r min-w-[120px] flex flex-col items-center justify-center p-1 cursor-pointer transition-colors relative h-16 group/header",
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
                                                    className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover/header:opacity-100 transition-opacity"
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
                            </div>
                        </div>

                        {/* 2. Timeline Body */}
                        <div
                            className="flex relative min-w-max"
                            style={{ height: `${(END_HOUR - START_HOUR) * 60 * PIXELS_PER_MINUTE}px` }}
                        >
                            {/* Time Axis (Sticky Left) */}
                            <div className="sticky left-0 z-30 w-12 flex-shrink-0 border-r bg-background">
                                {renderTimeAxis()}
                            </div>

                            {/* Grid & Columns */}
                            <div className="flex-1 flex relative">
                                {renderGridLines()}

                                {viewDates.map(date => {
                                    const dateStr = format(date, "yyyy-MM-dd");
                                    const isFocused = focusedDate?.getTime() === date.getTime();

                                    return (
                                        <div
                                            key={dateStr}
                                            onClick={() => setFocusedDate(date)}
                                            className={cn(
                                                "flex-1 border-r relative min-w-[120px] group/col transition-colors",
                                                isFocused ? "bg-primary/5" : ""
                                            )}
                                        >
                                            {/* Hover effect for column */}
                                            <div className={cn(
                                                "absolute inset-0 bg-transparent pointer-events-none transition-colors",
                                                !isFocused && "group-hover/col:bg-muted/10"
                                            )} />

                                            {/* 1. Render Busy Periods (Merged) */}
                                            {(() => {
                                                const relevantBusy = busyPeriods.filter(p => p.startsWith(dateStr));

                                                // 1. Convert to ranges
                                                const ranges: { start: number; end: number }[] = [];
                                                relevantBusy.forEach(bp => {
                                                    const [_, slot] = bp.split("_");
                                                    const type = slot.startsWith("P") ? "P" : "H";
                                                    const id = parseInt(slot.replace(/[PH]/, ""));
                                                    const info = getSlotInfo(type, id);
                                                    if (info) {
                                                        ranges.push({ start: info.startMin, end: info.endMin });
                                                    }
                                                });

                                                // 2. Sort ranges
                                                ranges.sort((a, b) => a.start - b.start);

                                                // 3. Merge ranges
                                                const merged: { start: number; end: number }[] = [];
                                                if (ranges.length > 0) {
                                                    let current = ranges[0];
                                                    for (let i = 1; i < ranges.length; i++) {
                                                        const next = ranges[i];
                                                        if (next.start < current.end) {
                                                            // Overlap or adjacent -> merge
                                                            current.end = Math.max(current.end, next.end);
                                                        } else {
                                                            // No overlap -> push current, start new
                                                            merged.push(current);
                                                            current = next;
                                                        }
                                                    }
                                                    merged.push(current);
                                                }

                                                // 4. Render merged blocks
                                                return merged.map((range, i) => {
                                                    const style = getBlockStyle(range.start, range.end);
                                                    return (
                                                        <div
                                                            key={`busy-merged-${i}`}
                                                            className="absolute inset-x-1 rounded px-2 py-1 text-[10px] sm:text-xs font-medium border overflow-hidden
                                                                       bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50 z-10 pointer-events-none"
                                                            style={style}
                                                        >
                                                            <span className="font-bold opacity-70">予定あり</span>
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

                                                return (
                                                    <div
                                                        key={sp}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            togglePeriod(dateStr, id, type);
                                                        }}
                                                        className="absolute inset-x-1 rounded px-2 py-1 text-[10px] sm:text-xs font-medium border cursor-pointer
                                                                   shadow-sm hover:shadow-md transition-all z-20 overflow-hidden
                                                                   bg-primary text-primary-foreground border-primary"
                                                        style={style}
                                                    >
                                                        <div className="flex justify-between items-start">
                                                            <span>{info.sub}</span>
                                                            <X className="w-3 h-3 opacity-50 hover:opacity-100" />
                                                        </div>
                                                        <div className="font-bold">{info.label}</div>
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
                        <span className="text-[10px] w-8 text-center font-medium">
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
