"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAllDayRange, type AllDayEventRange } from "@/lib/allDayEvents";

/**
 * Lets the user pick which imported all-day events to reflect. Holidays and reminders are
 * usually all-day events that do not block anything, so nothing is selected up front.
 * Remount with a new key per import so the selection starts empty.
 */
export function AllDayEventChoiceDialog({
    events,
    nearCount = events.length,
    description,
    onDone,
}: {
    /** Sorted by date. */
    events: AllDayEventRange[];
    /** The first nearCount events are listed up front; the rest sit behind a button. */
    nearCount?: number;
    description: string;
    /** Called with the chosen events; an empty array when the user declines. */
    onDone: (chosen: AllDayEventRange[]) => void;
}) {
    const [selected, setSelected] = React.useState<boolean[]>(() => events.map(() => false));
    const [showAll, setShowAll] = React.useState(nearCount === 0);
    const selectedCount = selected.filter(Boolean).length;
    const visible = showAll ? events : events.slice(0, nearCount);

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onDone([]); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>終日の予定を反映しますか</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <ul className="max-h-72 overflow-y-auto rounded-md border divide-y">
                    {visible.map((ev, i) => (
                        <li key={`${ev.start}|${ev.end}|${ev.summary}`}>
                            <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 shrink-0 accent-primary"
                                    checked={selected[i]}
                                    onChange={(e) => {
                                        const next = [...selected];
                                        next[i] = e.target.checked;
                                        setSelected(next);
                                    }}
                                />
                                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatAllDayRange(ev)}</span>
                                <span className="min-w-0 break-words">{ev.summary}</span>
                            </label>
                        </li>
                    ))}
                    {!showAll && nearCount < events.length && (
                        <li>
                            <button
                                type="button"
                                className="w-full px-3 py-2 text-sm text-primary hover:bg-muted/50"
                                onClick={() => setShowAll(true)}
                            >
                                さらに先の予定も表示（{events.length - nearCount}件）
                            </button>
                        </li>
                    )}
                </ul>
                <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                    <Button type="button" variant="outline" onClick={() => onDone([])}>
                        終日の予定は反映しない
                    </Button>
                    <Button
                        type="button"
                        onClick={() => onDone(events.filter((_, i) => selected[i]))}
                        disabled={selectedCount === 0}
                    >
                        {selectedCount > 0 ? `選んだ${selectedCount}件を反映` : "反映する予定を選んでください"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
