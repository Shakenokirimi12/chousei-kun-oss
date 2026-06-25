"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, CalendarClock } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { formatDateLabel } from "@/lib/officeHour";

type Item = {
    id: string;
    title: string;
    date: number;
    status: "collecting" | "published";
    createdAt: number;
};

export function ShiftListView() {
    const { userId } = useUser();
    const [items, setItems] = React.useState<Item[] | null>(null);

    React.useEffect(() => {
        if (!userId) return;
        (async () => {
            try {
                const res = await fetch(`/api/shifts/by-creator/${userId}`);
                if (res.ok) {
                    const data = (await res.json()) as { items: Item[] };
                    setItems(data.items.sort((a, b) => b.createdAt - a.createdAt));
                } else {
                    setItems([]);
                }
            } catch {
                setItems([]);
            }
        })();
    }, [userId]);

    return (
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">シフト調整</h1>
                <Button asChild size="sm" className="gap-1">
                    <Link href="/shifts/create">
                        <Plus className="size-4" /> 新規作成
                    </Link>
                </Button>
            </div>

            {items === null ? (
                <div className="flex min-h-[30vh] items-center justify-center">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    このデバイスで作成したシフト表はまだありません。
                </div>
            ) : (
                <ul className="space-y-2">
                    {items.map((it) => (
                        <li key={it.id}>
                            <Link
                                href={`/shifts/${it.id}/admin`}
                                className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent"
                            >
                                <div className="min-w-0">
                                    <div className="truncate font-medium">{it.title}</div>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <CalendarClock className="size-3" />
                                        {formatDateLabel(it.date)}
                                    </div>
                                </div>
                                <span
                                    className={
                                        it.status === "published"
                                            ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700"
                                            : "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700"
                                    }
                                >
                                    {it.status === "published" ? "公開済み" : "募集中"}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
