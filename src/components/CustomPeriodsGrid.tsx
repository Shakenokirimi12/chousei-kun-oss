"use client";

import * as React from "react";
import { CUSTOM_PERIODS, type CustomPeriod } from "@/config/periods";
import { Calendar, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomPeriodsGridProps {
    groupedDates: Record<string, string[]>;
    selectedPeriods: string[];
    togglePeriod: (id: string) => void;
    busyPeriodIds?: string[];
}

export default function CustomPeriodsGrid({ groupedDates, selectedPeriods, togglePeriod, busyPeriodIds }: CustomPeriodsGridProps) {
    return (
        <div className="mb-4">
            <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-tight">カスタム枠設定</h4>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-1">
                {CUSTOM_PERIODS.map((p: CustomPeriod) => {
                    // Extract the date from the first key in groupedDates (which is passed down)
                    const dateStr = Object.keys(groupedDates)[0];
                    const isSelected = selectedPeriods.includes(`${dateStr}_P${p.id}`);
                    const isBusy = busyPeriodIds?.includes(`${dateStr}_P${p.id}`);

                    return (
                        <button
                            key={p.id}
                            type="button"
                            aria-pressed={isSelected}
                            aria-label={`${p.label} ${p.time}${isBusy ? "（予定あり）" : ""}`}
                            className={cn(
                                "h-10 px-0 flex flex-col items-center justify-center gap-0.5 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                                isSelected ? "bg-primary text-primary-foreground shadow hover:bg-primary/90" : "bg-background hover:bg-accent hover:text-accent-foreground",
                                isBusy ? "opacity-50 cursor-not-allowed border-red-200 bg-red-50 text-red-500 hover:bg-red-50 hover:text-red-500" : ""
                            )}
                            onClick={() => togglePeriod(`_P${p.id}`)}
                            disabled={isBusy}
                        >
                            <span className="text-xs font-bold leading-none">{p.label}</span>
                            <span className="text-xs opacity-80 leading-none scale-90 origin-center whitespace-nowrap">
                                {p.time.split("-").map((t: string) => t.replace(/^0/, "")).join("-")}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
