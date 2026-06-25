"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Plus, GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMinutes, parseHm, snap, SNAP_MINUTES, rangesOverlap } from "@/lib/shift";

export type DraftSlot = {
    key: string;
    id?: string;
    startMin: number;
    endMin: number;
    role: string;
    place: string;
    capacity: number;
};

const DAY_MIN = 24 * 60;
const PX_PER_MIN = 1.1;
const ROW_H = 44;
const TRACK_W = DAY_MIN * PX_PER_MIN;

let keyCounter = 0;
export function newDraftSlot(startMin = 9 * 60, durationMin = 60): DraftSlot {
    keyCounter += 1;
    return {
        key: `slot-${keyCounter}-${startMin}`,
        startMin,
        endMin: Math.min(DAY_MIN, startMin + durationMin),
        role: "",
        place: "",
        capacity: 1,
    };
}

type DragMode = "move" | "start" | "end";

export function ShiftTimelineEditor({
    slots,
    onChange,
}: {
    slots: DraftSlot[];
    onChange: (slots: DraftSlot[]) => void;
}) {
    const slotsRef = React.useRef(slots);
    slotsRef.current = slots;
    const [selected, setSelected] = React.useState<string | null>(null);
    const [dragging, setDragging] = React.useState(false);

    const patchSlot = React.useCallback(
        (key: string, patch: Partial<DraftSlot>) => {
            onChange(slotsRef.current.map((s) => (s.key === key ? { ...s, ...patch } : s)));
        },
        [onChange]
    );

    const beginDrag = React.useCallback(
        (e: React.PointerEvent, key: string, mode: DragMode) => {
            e.preventDefault();
            e.stopPropagation();
            setSelected(key);
            setDragging(true);
            const startX = e.clientX;
            const orig = slotsRef.current.find((s) => s.key === key);
            if (!orig) return;
            const o = { startMin: orig.startMin, endMin: orig.endMin };
            const dur = o.endMin - o.startMin;

            const onMove = (ev: PointerEvent) => {
                const dMin = snap((ev.clientX - startX) / PX_PER_MIN);
                let startMin = o.startMin;
                let endMin = o.endMin;
                if (mode === "move") {
                    startMin = o.startMin + dMin;
                    endMin = o.endMin + dMin;
                    if (startMin < 0) {
                        startMin = 0;
                        endMin = dur;
                    }
                    if (endMin > DAY_MIN) {
                        endMin = DAY_MIN;
                        startMin = DAY_MIN - dur;
                    }
                } else if (mode === "start") {
                    startMin = Math.min(Math.max(0, o.startMin + dMin), o.endMin - SNAP_MINUTES);
                } else {
                    endMin = Math.max(Math.min(DAY_MIN, o.endMin + dMin), o.startMin + SNAP_MINUTES);
                }
                patchSlot(key, { startMin, endMin });
            };
            const onUp = () => {
                setDragging(false);
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [patchSlot]
    );

    const addSlot = () => {
        // 直近の枠の終了時刻から続けて追加すると編集しやすい。
        const last = slots[slots.length - 1];
        const start = last ? Math.min(DAY_MIN - 60, last.endMin) : 9 * 60;
        const next = newDraftSlot(start, 60);
        onChange([...slots, next]);
        setSelected(next.key);
    };

    const removeSlot = (key: string) => {
        onChange(slots.filter((s) => s.key !== key));
        if (selected === key) setSelected(null);
    };

    const hours = Array.from({ length: 25 }, (_, i) => i);

    return (
        <div className="space-y-4">
            {/* タイムライン（横スクロール） */}
            <div className="rounded-lg border bg-muted/20">
                <div className="overflow-x-auto">
                    <div style={{ width: TRACK_W + 16 }} className="relative px-2 pb-3 pt-6">
                        {/* 時刻目盛り */}
                        <div className="pointer-events-none absolute inset-x-2 top-0 h-full">
                            {hours.map((h) => (
                                <div
                                    key={h}
                                    className="absolute top-0 h-full border-l border-border/40"
                                    style={{ left: h * 60 * PX_PER_MIN }}
                                >
                                    <span className="absolute -top-0 left-1 text-[10px] text-muted-foreground">
                                        {h}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* 枠の行 */}
                        <div className="relative" style={{ height: Math.max(1, slots.length) * ROW_H }}>
                            {slots.map((s, idx) => {
                                const left = s.startMin * PX_PER_MIN;
                                const width = (s.endMin - s.startMin) * PX_PER_MIN;
                                const isSel = selected === s.key;
                                return (
                                    <div
                                        key={s.key}
                                        className="absolute"
                                        style={{ top: idx * ROW_H + 4, left, width, height: ROW_H - 12 }}
                                    >
                                        <div
                                            onPointerDown={(e) => beginDrag(e, s.key, "move")}
                                            className={cn(
                                                "group flex h-full w-full cursor-grab touch-none select-none items-center justify-between rounded-md border px-1 text-xs shadow-sm",
                                                isSel
                                                    ? "border-primary bg-primary/15 ring-1 ring-primary"
                                                    : "border-primary/40 bg-primary/10 hover:bg-primary/15",
                                                dragging && isSel && "cursor-grabbing"
                                            )}
                                        >
                                            {/* 開始ハンドル */}
                                            <span
                                                onPointerDown={(e) => beginDrag(e, s.key, "start")}
                                                className="h-full w-2 shrink-0 cursor-ew-resize rounded-l bg-primary/50 group-hover:bg-primary/70"
                                            />
                                            <span className="pointer-events-none flex-1 truncate px-1 text-center font-medium text-foreground">
                                                {s.role || "（役割未設定）"}
                                                <span className="ml-1 font-normal text-muted-foreground">
                                                    {formatMinutes(s.startMin)}–{formatMinutes(s.endMin)}
                                                </span>
                                            </span>
                                            {/* 終了ハンドル */}
                                            <span
                                                onPointerDown={(e) => beginDrag(e, s.key, "end")}
                                                className="h-full w-2 shrink-0 cursor-ew-resize rounded-r bg-primary/50 group-hover:bg-primary/70"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                            {slots.length === 0 && (
                                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                    枠がありません。下の「枠を追加」から作成してください。
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 枠ごとの詳細入力 */}
            <div className="space-y-2">
                {slots.map((s) => (
                    <SlotRow
                        key={s.key}
                        slot={s}
                        selected={selected === s.key}
                        conflict={slots.some(
                            (o) =>
                                o.key !== s.key &&
                                o.role.trim() !== "" &&
                                o.role === s.role &&
                                rangesOverlap(s.startMin, s.endMin, o.startMin, o.endMin)
                        )}
                        onSelect={() => setSelected(s.key)}
                        onPatch={(patch) => patchSlot(s.key, patch)}
                        onRemove={() => removeSlot(s.key)}
                    />
                ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={addSlot} className="gap-1">
                <Plus className="size-4" /> 枠を追加
            </Button>
        </div>
    );
}

function SlotRow({
    slot,
    selected,
    conflict,
    onSelect,
    onPatch,
    onRemove,
}: {
    slot: DraftSlot;
    selected: boolean;
    conflict: boolean;
    onSelect: () => void;
    onPatch: (patch: Partial<DraftSlot>) => void;
    onRemove: () => void;
}) {
    const onTimeChange = (field: "startMin" | "endMin", value: string) => {
        const min = parseHm(value);
        if (min === null) return;
        if (field === "startMin" && min >= slot.endMin) return;
        if (field === "endMin" && min <= slot.startMin) return;
        onPatch({ [field]: Math.max(0, Math.min(DAY_MIN, min)) });
    };

    return (
        <div
            onClick={onSelect}
            className={cn(
                "grid grid-cols-12 items-center gap-2 rounded-lg border p-2",
                selected ? "border-primary bg-primary/5" : "border-border"
            )}
        >
            <GripHorizontal className="col-span-12 size-4 text-muted-foreground sm:col-span-1" />
            <Input
                className="col-span-6 sm:col-span-3"
                placeholder="役割 / タスク名"
                value={slot.role}
                onChange={(e) => onPatch({ role: e.target.value })}
            />
            <Input
                className="col-span-6 sm:col-span-2"
                placeholder="場所"
                value={slot.place}
                onChange={(e) => onPatch({ place: e.target.value })}
            />
            <Input
                className="col-span-5 sm:col-span-2"
                type="time"
                step={SNAP_MINUTES * 60}
                value={formatMinutes(Math.min(slot.startMin, DAY_MIN - 1))}
                onChange={(e) => onTimeChange("startMin", e.target.value)}
            />
            <Input
                className="col-span-5 sm:col-span-2"
                type="time"
                step={SNAP_MINUTES * 60}
                // ネイティブ time 入力は 24:00 を受け付けないため表示上は 23:59 にクランプ。
                value={formatMinutes(Math.min(slot.endMin, DAY_MIN - 1))}
                onChange={(e) => onTimeChange("endMin", e.target.value)}
            />
            <div className="col-span-2 flex items-center gap-1">
                <Input
                    className="w-14"
                    type="number"
                    min={1}
                    max={1000}
                    title="定員"
                    value={slot.capacity}
                    onChange={(e) =>
                        onPatch({ capacity: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })
                    }
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    aria-label="枠を削除"
                >
                    <Trash2 className="size-4 text-destructive" />
                </Button>
            </div>
            {conflict && (
                <p className="col-span-12 text-xs text-amber-600">
                    同じ役割で時間が重複している枠があります。
                </p>
            )}
        </div>
    );
}
