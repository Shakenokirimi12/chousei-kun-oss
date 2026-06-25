"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, Trash2, Users } from "lucide-react";
import { formatMinutes, parseHm, SNAP_MINUTES } from "@/lib/shift";

export type SegmentDialogData = {
    id: string;
    role: string;
    startMin: number;
    endMin: number;
    place: string;
    capacity: number;
};

/**
 * シフト区分の編集＋メンバー割当ダイアログ。役割ビュー・人ビューの双方から使う共通部品。
 */
export function SegmentDialog({
    open,
    onOpenChange,
    seg,
    onPatch,
    onDelete,
    renderAssign,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    seg: SegmentDialogData | null;
    onPatch: (p: Partial<SegmentDialogData>) => void;
    onDelete: (e: React.MouseEvent) => void;
    renderAssign?: React.ReactNode;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                {seg && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Clock className="size-4 text-primary" />
                                {seg.role || "時間区分"} の編集
                            </DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-1 text-xs">
                                <span className="text-muted-foreground">開始</span>
                                <Input
                                    type="time"
                                    step={SNAP_MINUTES * 60}
                                    value={formatMinutes(Math.min(seg.startMin, 1439))}
                                    onChange={(e) => {
                                        const m = parseHm(e.target.value);
                                        if (m !== null && m < seg.endMin) onPatch({ startMin: m });
                                    }}
                                />
                            </label>
                            <label className="space-y-1 text-xs">
                                <span className="text-muted-foreground">終了</span>
                                <Input
                                    type="time"
                                    step={SNAP_MINUTES * 60}
                                    value={formatMinutes(Math.min(seg.endMin, 1439))}
                                    onChange={(e) => {
                                        const m = parseHm(e.target.value);
                                        if (m !== null && m > seg.startMin) onPatch({ endMin: m });
                                    }}
                                />
                            </label>
                            <label className="space-y-1 text-xs">
                                <span className="text-muted-foreground">場所</span>
                                <Input value={seg.place} onChange={(e) => onPatch({ place: e.target.value })} placeholder="場所" />
                            </label>
                            <label className="space-y-1 text-xs">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <Users className="size-3" /> 定員
                                </span>
                                <Input
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={seg.capacity}
                                    onChange={(e) =>
                                        onPatch({ capacity: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })
                                    }
                                />
                            </label>
                        </div>

                        {renderAssign && <div className="border-t pt-3">{renderAssign}</div>}

                        <div className="flex justify-between border-t pt-3">
                            <Button variant="ghost" size="sm" title="Ctrl/⌘+クリックで確認なし" onClick={onDelete} className="gap-1 text-destructive">
                                <Trash2 className="size-4" /> 区分を削除
                            </Button>
                            <Button size="sm" onClick={() => onOpenChange(false)}>
                                完了
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
