"use client";

import * as React from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    Loader2,
    AlertCircle,
    CheckCircle2,
    CalendarClock,
    MapPin,
    Users,
    Ban,
    Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/useUser";
import { formatDateLabel } from "@/lib/officeHour";
import {
    formatMinutes,
    msToMinutes,
    type ShiftPublicView,
    type ShiftMemberDetail,
} from "@/lib/shift";

function memberStorageKey(boardId: string) {
    return `chosei_shift_member_${boardId}`;
}

export function ShiftMemberView({ boardId }: { boardId: string }) {
    const { userId } = useUser();
    const [view, setView] = React.useState<ShiftPublicView | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState<string | null>(null);

    const [memberId, setMemberId] = React.useState<string | null>(null);
    const [name, setName] = React.useState("");
    const [comment, setComment] = React.useState("");
    // NG（出られない）枠の id 集合。
    const [ngSet, setNgSet] = React.useState<Set<string>>(new Set());
    const [assignedSlotIds, setAssignedSlotIds] = React.useState<Set<string>>(new Set());

    const [submitting, setSubmitting] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const [saved, setSaved] = React.useState(false);

    // 公開ビューの取得。
    React.useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/shifts/${boardId}`);
                if (res.status === 410) {
                    setLoadError("このシフト表は削除されました。");
                    return;
                }
                if (!res.ok) {
                    setLoadError("シフト表が見つかりませんでした。");
                    return;
                }
                setView((await res.json()) as ShiftPublicView);
            } catch {
                setLoadError("読み込みに失敗しました。");
            } finally {
                setLoading(false);
            }
        })();
    }, [boardId]);

    // 既存メンバーの復元。
    React.useEffect(() => {
        const stored = localStorage.getItem(memberStorageKey(boardId));
        if (!stored) return;
        setMemberId(stored);
        (async () => {
            try {
                const res = await fetch(`/api/shifts/${boardId}/member/${stored}`);
                if (!res.ok) {
                    localStorage.removeItem(memberStorageKey(boardId));
                    setMemberId(null);
                    return;
                }
                const m = (await res.json()) as ShiftMemberDetail;
                setName(m.name);
                setComment(m.comment ?? "");
                setNgSet(new Set(m.unavailableSlotIds));
                setAssignedSlotIds(new Set(m.assignedSlotIds));
            } catch {
                /* ignore */
            }
        })();
    }, [boardId]);

    const toggleNg = (slotId: string) => {
        setSaved(false);
        setNgSet((prev) => {
            const next = new Set(prev);
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- JS Set, not a Drizzle query
            if (next.has(slotId)) next.delete(slotId);
            else next.add(slotId);
            return next;
        });
    };

    const handleSubmit = async () => {
        setSubmitError(null);
        if (!name.trim()) return setSubmitError("名前を入力してください。");
        setSubmitting(true);
        try {
            const res = await fetch(`/api/shifts/${boardId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    comment,
                    memberId: memberId ?? undefined,
                    userId: userId ?? undefined,
                    unavailableSlotIds: [...ngSet],
                }),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(data.error ?? "送信に失敗しました。");
            }
            const data = (await res.json()) as { memberId: string };
            setMemberId(data.memberId);
            localStorage.setItem(memberStorageKey(boardId), data.memberId);
            setSaved(true);
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : "エラーが発生しました。");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (loadError || !view) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-16 text-center">
                <AlertCircle className="mx-auto size-10 text-muted-foreground" />
                <p className="mt-3 text-muted-foreground">{loadError ?? "見つかりませんでした。"}</p>
            </div>
        );
    }

    const { board, slots, assignments } = view;
    const orderedSlots = [...slots].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.startsAt - b.startsAt
    );
    const isPublished = board.status === "published";

    return (
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
            <header className="space-y-1">
                <h1 className="text-2xl font-bold">{board.title}</h1>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CalendarClock className="size-4" />
                    {formatDateLabel(board.date)}
                </p>
                {board.description && (
                    <p className="whitespace-pre-wrap pt-1 text-sm text-muted-foreground">
                        {board.description}
                    </p>
                )}
            </header>

            {isPublished ? (
                <PublishedRoster
                    boardDate={board.date}
                    slots={orderedSlots}
                    assignments={assignments}
                    myAssigned={assignedSlotIds}
                />
            ) : (
                <>
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                        出られない枠だけを <Ban className="inline size-4 text-destructive" /> でマークして送信してください。
                        マークしなかった枠は「出られる」として扱われます。
                    </div>

                    <div className="space-y-3">
                        <Input
                            placeholder="あなたの名前"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setSaved(false);
                            }}
                            maxLength={100}
                        />

                        <div className="space-y-2">
                            {orderedSlots.map((s) => {
                                const ng = ngSet.has(s.id);
                                return (
                                    <button
                                        type="button"
                                        key={s.id}
                                        onClick={() => toggleNg(s.id)}
                                        className={cn(
                                            "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
                                            ng
                                                ? "border-destructive/50 bg-destructive/10"
                                                : "border-border hover:border-primary/40 hover:bg-accent"
                                        )}
                                    >
                                        <div className="min-w-0">
                                            <div className="font-medium">{s.role}</div>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                                <span>
                                                    {formatMinutes(msToMinutes(s.startsAt, board.date))}–
                                                    {formatMinutes(msToMinutes(s.endsAt, board.date))}
                                                </span>
                                                {s.place && (
                                                    <span className="flex items-center gap-0.5">
                                                        <MapPin className="size-3" />
                                                        {s.place}
                                                    </span>
                                                )}
                                                <span className="flex items-center gap-0.5">
                                                    <Users className="size-3" />
                                                    定員 {s.capacity}
                                                </span>
                                            </div>
                                        </div>
                                        <span
                                            className={cn(
                                                "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                                                ng
                                                    ? "bg-destructive text-white"
                                                    : "bg-muted text-muted-foreground"
                                            )}
                                        >
                                            <Ban className="size-3.5" />
                                            {ng ? "出られない" : "出られる"}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <Textarea
                            placeholder="連絡事項・コメント（任意）"
                            value={comment}
                            onChange={(e) => {
                                setComment(e.target.value);
                                setSaved(false);
                            }}
                            rows={2}
                            maxLength={1000}
                        />

                        {submitError && (
                            <p className="flex items-center gap-1.5 text-sm text-destructive">
                                <AlertCircle className="size-4" />
                                {submitError}
                            </p>
                        )}
                        {saved && (
                            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
                                <CheckCircle2 className="size-4" />
                                送信しました。割当が公開されるとここで確認できます。
                            </p>
                        )}

                        <Button onClick={handleSubmit} disabled={submitting} className="w-full gap-2">
                            {submitting && <Loader2 className="size-4 animate-spin" />}
                            {memberId ? "回答を更新" : "送信"}
                        </Button>
                    </div>
                </>
            )}

            <footer className="border-t pt-4 text-center text-xs text-muted-foreground">
                <Link href={`/shifts/${boardId}/admin`} className="underline hover:text-foreground">
                    管理者の方はこちら
                </Link>
            </footer>
        </div>
    );
}

function PublishedRoster({
    boardDate,
    slots,
    assignments,
    myAssigned,
}: {
    boardDate: number;
    slots: ShiftPublicView["slots"];
    assignments: ShiftPublicView["assignments"];
    myAssigned: Set<string>;
}) {
    const bySlot = new Map<string, string[]>();
    for (const a of assignments) {
        const arr = bySlot.get(a.slotId) ?? [];
        if (a.name) arr.push(a.name);
        bySlot.set(a.slotId, arr);
    }

    return (
        <div className="space-y-4">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                <CheckCircle2 className="mr-1 inline size-4 text-emerald-600" />
                シフトが公開されました。あなたの担当枠は強調表示されています。
            </div>
            <div className="space-y-2">
                {slots.map((s) => {
                    const names = bySlot.get(s.id) ?? [];
                    const mine = myAssigned.has(s.id);
                    return (
                        <div
                            key={s.id}
                            className={cn(
                                "rounded-lg border p-3",
                                mine ? "border-primary bg-primary/5" : "border-border"
                            )}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="font-medium">
                                    {s.role}
                                    {mine && (
                                        <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                                            担当
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {formatMinutes(msToMinutes(s.startsAt, boardDate))}–
                                    {formatMinutes(msToMinutes(s.endsAt, boardDate))}
                                </div>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                                {s.place && (
                                    <span className="flex items-center gap-0.5">
                                        <MapPin className="size-3" />
                                        {s.place}
                                    </span>
                                )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {names.length > 0 ? (
                                    names.map((n, i) => (
                                        <span
                                            key={i}
                                            className="rounded-full bg-muted px-2 py-0.5 text-xs"
                                        >
                                            {n}
                                        </span>
                                    ))
                                ) : (
                                    <span className="flex items-center gap-1 text-xs text-amber-600">
                                        <Lock className="size-3" />
                                        未割当
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
