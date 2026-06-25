"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMinutes, parseHm, snap, SNAP_MINUTES, rangesOverlap } from "@/lib/shift";

export type Segment = {
    id: string;
    startMin: number;
    endMin: number;
    place: string;
    capacity: number;
};
export type Lane = {
    laneId: string;
    role: string;
    segments: Segment[];
};

const PX_PER_MIN = 2;
const ROW_H = 56;
const LABEL_W = 180;

let counter = 0;
const uid = (prefix: string) => {
    counter += 1;
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${prefix}-${counter}`;
};

export function newLane(role = ""): Lane {
    return { laneId: uid("lane"), role, segments: [] };
}

type DragMode = "move" | "start" | "end";

/**
 * Excel 風の多段ガント。1 行 = 役割(レーン)、行内に複数の時間区分(segment)を横に並べる。
 * 区分はドラッグで移動/時間調整、クリックで編集ダイアログ。メンバー割当は扱わない。
 */
export function ShiftLaneGantt({
    axisStartMin,
    axisEndMin,
    lanes,
    onChange,
    assignedCount,
    renderSegmentAssign,
}: {
    axisStartMin: number;
    axisEndMin: number;
    lanes: Lane[];
    onChange: (lanes: Lane[]) => void;
    /** 区分の割当人数（バー表示・ダイアログ見出し用）。 */
    assignedCount?: (segId: string) => number;
    /** 区分編集ダイアログ内に差し込む割当UI（メンバー選択など）。 */
    renderSegmentAssign?: (segId: string) => React.ReactNode;
}) {
    const lanesRef = React.useRef(lanes);
    lanesRef.current = lanes;
    const [editing, setEditing] = React.useState<{ laneId: string; segId: string } | null>(null);

    const span = Math.max(1, axisEndMin - axisStartMin);
    const trackW = span * PX_PER_MIN;

    const patchSeg = (laneId: string, segId: string, p: Partial<Segment>) =>
        onChange(
            lanesRef.current.map((l) =>
                l.laneId === laneId
                    ? { ...l, segments: l.segments.map((s) => (s.id === segId ? { ...s, ...p } : s)) }
                    : l
            )
        );

    const beginDrag = (e: React.PointerEvent, laneId: string, segId: string, mode: DragMode) => {
        e.preventDefault();
        e.stopPropagation();
        const lane = lanesRef.current.find((l) => l.laneId === laneId);
        const seg = lane?.segments.find((s) => s.id === segId);
        if (!seg) return;
        const startX = e.clientX;
        const o = { s: seg.startMin, e: seg.endMin };
        const dur = o.e - o.s;
        let moved = false;
        const onMove = (ev: PointerEvent) => {
            if (Math.abs(ev.clientX - startX) > 3) moved = true;
            const d = snap((ev.clientX - startX) / PX_PER_MIN);
            let s = o.s;
            let en = o.e;
            if (mode === "move") {
                s = o.s + d;
                en = o.e + d;
                if (s < axisStartMin) {
                    s = axisStartMin;
                    en = axisStartMin + dur;
                }
                if (en > axisEndMin) {
                    en = axisEndMin;
                    s = axisEndMin - dur;
                }
            } else if (mode === "start") {
                s = Math.min(Math.max(axisStartMin, o.s + d), o.e - SNAP_MINUTES);
            } else {
                en = Math.max(Math.min(axisEndMin, o.e + d), o.s + SNAP_MINUTES);
            }
            patchSeg(laneId, segId, { startMin: s, endMin: en });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (!moved && mode === "move") setEditing({ laneId, segId });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const addSegment = (laneId: string) => {
        const lane = lanesRef.current.find((l) => l.laneId === laneId);
        if (!lane) return;
        const last = [...lane.segments].sort((a, b) => a.endMin - b.endMin).at(-1);
        const start = last ? Math.min(axisEndMin - 30, last.endMin) : axisStartMin;
        const end = Math.min(axisEndMin, start + 60);
        const seg: Segment = { id: uid("seg"), startMin: start, endMin: end, place: last?.place ?? "", capacity: last?.capacity ?? 1 };
        onChange(lanes.map((l) => (l.laneId === laneId ? { ...l, segments: [...l.segments, seg] } : l)));
    };
    const removeSegment = (laneId: string, segId: string) => {
        onChange(
            lanes.map((l) => (l.laneId === laneId ? { ...l, segments: l.segments.filter((s) => s.id !== segId) } : l))
        );
        setEditing(null);
    };
    const removeLane = (laneId: string) => onChange(lanes.filter((l) => l.laneId !== laneId));
    const renameLane = (laneId: string, role: string) =>
        onChange(lanes.map((l) => (l.laneId === laneId ? { ...l, role } : l)));

    const hourTicks: number[] = [];
    for (let m = Math.ceil(axisStartMin / 60) * 60; m <= axisEndMin; m += 60) hourTicks.push(m);

    const editingLane = editing ? lanes.find((l) => l.laneId === editing.laneId) : null;
    const editingSeg = editingLane?.segments.find((s) => s.id === editing?.segId) ?? null;

    return (
        <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border bg-muted/20">
                <div style={{ width: LABEL_W + trackW + 16 }} className="min-w-full">
                    {/* 時刻ヘッダ */}
                    <div className="flex border-b">
                        <div
                            className="sticky left-0 z-10 shrink-0 border-r bg-muted/40"
                            style={{ width: LABEL_W }}
                        />
                        <div className="relative h-6" style={{ width: trackW }}>
                            {hourTicks.map((m) => (
                                <div
                                    key={m}
                                    className="absolute top-0 h-full border-l border-border/40"
                                    style={{ left: (m - axisStartMin) * PX_PER_MIN }}
                                >
                                    <span className="absolute left-1 text-[10px] text-muted-foreground">
                                        {formatMinutes(m)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* レーン（役割）行 */}
                    {lanes.map((lane) => {
                        // 同一レーン内の時間重複を検出（赤表示）。
                        const overlapIds = new Set<string>();
                        for (let i = 0; i < lane.segments.length; i++)
                            for (let j = i + 1; j < lane.segments.length; j++)
                                if (
                                    rangesOverlap(
                                        lane.segments[i].startMin,
                                        lane.segments[i].endMin,
                                        lane.segments[j].startMin,
                                        lane.segments[j].endMin
                                    )
                                ) {
                                    overlapIds.add(lane.segments[i].id);
                                    overlapIds.add(lane.segments[j].id);
                                }
                        return (
                            <div key={lane.laneId} className="flex border-b last:border-b-0">
                                <div
                                    className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r bg-background p-1.5"
                                    style={{ width: LABEL_W }}
                                >
                                    <Input
                                        className="h-7 text-xs"
                                        placeholder="役割（例: 受付）"
                                        value={lane.role}
                                        onChange={(e) => renameLane(lane.laneId, e.target.value)}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        title="区分を追加"
                                        onClick={() => addSegment(lane.laneId)}
                                    >
                                        <Plus className="size-3.5" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        title="この行（役割）を削除（Ctrl/⌘+クリックで確認なし）"
                                        onClick={(e) => {
                                            if (
                                                e.metaKey ||
                                                e.ctrlKey ||
                                                window.confirm(
                                                    `「${lane.role || "この行"}」を削除しますか？\n含まれる時間区分もすべて削除されます。`
                                                )
                                            )
                                                removeLane(lane.laneId);
                                        }}
                                    >
                                        <Trash2 className="size-3.5 text-destructive" />
                                    </Button>
                                </div>
                                <div className="relative" style={{ width: trackW, height: ROW_H }}>
                                    {hourTicks.map((m) => (
                                        <div
                                            key={m}
                                            className="absolute top-0 h-full border-l border-border/20"
                                            style={{ left: (m - axisStartMin) * PX_PER_MIN }}
                                        />
                                    ))}
                                    {lane.segments.map((s) => {
                                        const left = (s.startMin - axisStartMin) * PX_PER_MIN;
                                        const width = (s.endMin - s.startMin) * PX_PER_MIN;
                                        const bad = overlapIds.has(s.id);
                                        const ac = assignedCount?.(s.id);
                                        // 割当状況で色分け（未割当=赤 / 一部=青 / 定員ちょうど=緑 / 超過=黄）。
                                        const status = bad
                                            ? "bad"
                                            : ac == null
                                              ? "plain"
                                              : ac > s.capacity
                                                ? "over"
                                                : ac === s.capacity
                                                  ? "full"
                                                  : ac === 0
                                                    ? "empty"
                                                    : "partial";
                                        const tone = {
                                            bad: "border-destructive bg-destructive/15 text-destructive",
                                            over: "border-amber-500 bg-amber-400/30 text-amber-900",
                                            full: "border-emerald-500 bg-emerald-500/20 text-emerald-900",
                                            empty: "border-rose-300 bg-rose-50 text-rose-700",
                                            partial: "border-primary bg-primary/15 text-foreground",
                                            plain: "border-primary/50 bg-primary/15 text-foreground",
                                        }[status];
                                        const handle = bad
                                            ? "bg-destructive/40"
                                            : status === "full"
                                              ? "bg-emerald-500/50"
                                              : status === "empty"
                                                ? "bg-rose-300"
                                                : status === "over"
                                                  ? "bg-amber-500/50"
                                                  : "bg-primary/40";
                                        return (
                                            <div
                                                key={s.id}
                                                onPointerDown={(e) => beginDrag(e, lane.laneId, s.id, "move")}
                                                className={cn(
                                                    "group absolute top-1.5 flex cursor-grab touch-none select-none items-stretch overflow-hidden rounded-md border shadow-sm",
                                                    tone
                                                )}
                                                style={{ left, width, height: ROW_H - 14 }}
                                                title={`${formatMinutes(s.startMin)}–${formatMinutes(s.endMin)}${
                                                    ac != null ? ` / ${ac}人 (定員${s.capacity})` : ""
                                                }`}
                                            >
                                                <span
                                                    onPointerDown={(e) => beginDrag(e, lane.laneId, s.id, "start")}
                                                    className={cn("w-1.5 shrink-0 cursor-ew-resize", handle)}
                                                />
                                                <span className="pointer-events-none flex flex-1 flex-col justify-center overflow-hidden px-1 text-center leading-tight">
                                                    <span className="truncate text-[11px] font-medium">
                                                        {formatMinutes(s.startMin)}–{formatMinutes(s.endMin)}
                                                    </span>
                                                    {ac != null && (
                                                        <span className="flex items-center justify-center gap-0.5 text-[11px] font-semibold">
                                                            <Users className="size-3" />
                                                            {ac}/{s.capacity}
                                                        </span>
                                                    )}
                                                </span>
                                                <span
                                                    onPointerDown={(e) => beginDrag(e, lane.laneId, s.id, "end")}
                                                    className={cn("w-1.5 shrink-0 cursor-ew-resize", handle)}
                                                />
                                            </div>
                                        );
                                    })}
                                    {lane.segments.length === 0 && (
                                        <span className="absolute left-2 top-3 text-[11px] text-muted-foreground">
                                            ＋で時間区分を追加
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {lanes.length === 0 && (
                        <div className="p-4 text-center text-xs text-muted-foreground">
                            「役割（行）を追加」から作成してください。
                        </div>
                    )}
                </div>
            </div>

            <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lanes, newLane()])} className="gap-1">
                <Plus className="size-4" /> 役割（行）を追加
            </Button>

            <Dialog open={!!editingSeg} onOpenChange={(o) => !o && setEditing(null)}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                    {editingSeg && editing && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Clock className="size-4 text-primary" />
                                    {editingLane?.role || "時間区分"} の編集
                                </DialogTitle>
                            </DialogHeader>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="space-y-1 text-xs">
                                    <span className="text-muted-foreground">開始</span>
                                    <Input
                                        type="time"
                                        step={SNAP_MINUTES * 60}
                                        value={formatMinutes(Math.min(editingSeg.startMin, 1439))}
                                        onChange={(e) => {
                                            const m = parseHm(e.target.value);
                                            if (m !== null && m < editingSeg.endMin)
                                                patchSeg(editing.laneId, editingSeg.id, { startMin: m });
                                        }}
                                    />
                                </label>
                                <label className="space-y-1 text-xs">
                                    <span className="text-muted-foreground">終了</span>
                                    <Input
                                        type="time"
                                        step={SNAP_MINUTES * 60}
                                        value={formatMinutes(Math.min(editingSeg.endMin, 1439))}
                                        onChange={(e) => {
                                            const m = parseHm(e.target.value);
                                            if (m !== null && m > editingSeg.startMin)
                                                patchSeg(editing.laneId, editingSeg.id, { endMin: m });
                                        }}
                                    />
                                </label>
                                <label className="space-y-1 text-xs">
                                    <span className="text-muted-foreground">場所</span>
                                    <Input
                                        value={editingSeg.place}
                                        onChange={(e) => patchSeg(editing.laneId, editingSeg.id, { place: e.target.value })}
                                        placeholder="場所"
                                    />
                                </label>
                                <label className="space-y-1 text-xs">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                        <Users className="size-3" /> 定員
                                    </span>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={1000}
                                        value={editingSeg.capacity}
                                        onChange={(e) =>
                                            patchSeg(editing.laneId, editingSeg.id, {
                                                capacity: Math.max(1, Math.min(1000, Number(e.target.value) || 1)),
                                            })
                                        }
                                    />
                                </label>
                            </div>
                            {renderSegmentAssign && (
                                <div className="border-t pt-3">{renderSegmentAssign(editingSeg.id)}</div>
                            )}

                            <div className="flex justify-between border-t pt-3">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Ctrl/⌘+クリックで確認なし"
                                    onClick={(e) => {
                                        if (
                                            e.metaKey ||
                                            e.ctrlKey ||
                                            window.confirm("この時間区分を削除しますか？")
                                        )
                                            removeSegment(editing.laneId, editingSeg.id);
                                    }}
                                    className="gap-1 text-destructive"
                                >
                                    <Trash2 className="size-4" /> 区分を削除
                                </Button>
                                <Button size="sm" onClick={() => setEditing(null)}>
                                    完了
                                </Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
