"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMinutes } from "@/lib/shift";

export type MemberBar = {
    segId: string;
    startMin: number;
    endMin: number;
    label: string;
    conflict: boolean;
};
export type MemberRow = {
    id: string;
    name: string;
    department: string | null;
    bars: MemberBar[];
};

const PX_PER_MIN = 2;
const LABEL_W = 180;
const SEG_H = 40;
const SUBROW_H = 46;
const LANE_PAD = 8;

/**
 * 人ごとのシフト表（ガント）。1 行 = メンバー、その人に割り当てられた区分をバー表示。
 * バーをクリックすると親が編集ダイアログを開く（onActivateSegment）。
 * 同一人物が時間の重なる枠に入っている場合は複数段に積み、重複は赤で警告。
 */
export function ShiftMemberGantt({
    axisStartMin,
    axisEndMin,
    rows,
    onActivateSegment,
}: {
    axisStartMin: number;
    axisEndMin: number;
    rows: MemberRow[];
    onActivateSegment?: (segId: string) => void;
}) {
    const span = Math.max(1, axisEndMin - axisStartMin);
    const trackW = span * PX_PER_MIN;
    const hourTicks: number[] = [];
    for (let m = Math.ceil(axisStartMin / 60) * 60; m <= axisEndMin; m += 60) hourTicks.push(m);

    return (
        <div className="overflow-x-auto rounded-lg border bg-muted/20">
            <div style={{ width: LABEL_W + trackW + 16 }} className="min-w-full">
                {/* 時刻ヘッダ */}
                <div className="flex border-b">
                    <div className="sticky left-0 z-10 shrink-0 border-r bg-muted/40" style={{ width: LABEL_W }} />
                    <div className="relative h-6" style={{ width: trackW }}>
                        {hourTicks.map((m) => (
                            <div
                                key={m}
                                className="absolute top-0 h-full border-l border-border/40"
                                style={{ left: (m - axisStartMin) * PX_PER_MIN }}
                            >
                                <span className="absolute left-1 text-[10px] text-muted-foreground">{formatMinutes(m)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {rows.map((row) => {
                    // 重なるバーを段に振り分ける（貪欲法）。
                    const trackOf = new Map<string, number>();
                    const trackEnds: number[] = [];
                    for (const b of [...row.bars].sort((a, b2) => a.startMin - b2.startMin || a.endMin - b2.endMin)) {
                        let t = trackEnds.findIndex((end) => end <= b.startMin);
                        if (t === -1) {
                            t = trackEnds.length;
                            trackEnds.push(b.endMin);
                        } else {
                            trackEnds[t] = b.endMin;
                        }
                        trackOf.set(b.segId, t);
                    }
                    const trackCount = Math.max(1, trackEnds.length);
                    const rowH = trackCount * SUBROW_H + LANE_PAD;
                    return (
                        <div key={row.id} className="flex border-b last:border-b-0">
                            <div
                                className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r bg-background px-2 py-1"
                                style={{ width: LABEL_W }}
                            >
                                <span className="truncate text-sm font-medium">{row.name}</span>
                                {row.department && (
                                    <span className="truncate text-[11px] text-muted-foreground">{row.department}</span>
                                )}
                                <span className="text-[11px] text-muted-foreground">{row.bars.length} 件</span>
                            </div>
                            <div className="relative" style={{ width: trackW, height: rowH }}>
                                {hourTicks.map((m) => (
                                    <div
                                        key={m}
                                        className="absolute top-0 h-full border-l border-border/20"
                                        style={{ left: (m - axisStartMin) * PX_PER_MIN }}
                                    />
                                ))}
                                {row.bars.map((b) => {
                                    const left = (b.startMin - axisStartMin) * PX_PER_MIN;
                                    const width = (b.endMin - b.startMin) * PX_PER_MIN;
                                    const top = (trackOf.get(b.segId) ?? 0) * SUBROW_H + LANE_PAD / 2;
                                    return (
                                        <button
                                            type="button"
                                            key={b.segId}
                                            onClick={() => onActivateSegment?.(b.segId)}
                                            title={`${b.label} ${formatMinutes(b.startMin)}–${formatMinutes(b.endMin)}`}
                                            className={cn(
                                                "absolute flex flex-col justify-center overflow-hidden rounded-md border px-1.5 text-left text-[11px] leading-tight shadow-sm transition-colors",
                                                b.conflict
                                                    ? "border-amber-500 bg-amber-400/40 text-amber-950 hover:bg-amber-400/60"
                                                    : "border-primary/50 bg-primary/15 text-foreground hover:bg-primary/25"
                                            )}
                                            style={{ left, width, top, height: SEG_H }}
                                        >
                                            <span className="truncate font-medium">{b.label}</span>
                                            <span className="truncate text-muted-foreground">
                                                {formatMinutes(b.startMin)}–{formatMinutes(b.endMin)}
                                            </span>
                                        </button>
                                    );
                                })}
                                {row.bars.length === 0 && (
                                    <span className="absolute left-2 top-3 text-[11px] text-muted-foreground">割当なし</span>
                                )}
                            </div>
                        </div>
                    );
                })}

                {rows.length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground">回答メンバーがいません。</div>
                )}
            </div>
        </div>
    );
}
