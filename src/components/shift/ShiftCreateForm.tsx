"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CalendarClock } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { parseDateInput, formatIsoDate } from "@/lib/officeHour";
import { minutesToMs, msToMinutes } from "@/lib/shift";
import { ShiftTimelineEditor, newDraftSlot, type DraftSlot } from "./ShiftTimelineEditor";

export type ShiftEditData = {
    id: string;
    title: string;
    description: string | null;
    date: number;
    submissionDeadline: number | null;
    slots: {
        id: string;
        startsAt: number;
        endsAt: number;
        role: string;
        place: string | null;
        capacity: number;
        sortOrder: number;
    }[];
};

let editKeyCounter = 0;

export function ShiftCreateForm({ editData }: { editData?: ShiftEditData } = {}) {
    const isEdit = !!editData;
    const router = useRouter();
    const { userId } = useUser();

    const [title, setTitle] = React.useState(editData?.title ?? "");
    const [description, setDescription] = React.useState(editData?.description ?? "");
    const [dateStr, setDateStr] = React.useState(
        editData ? formatIsoDate(editData.date) : ""
    );
    const [adminPassword, setAdminPassword] = React.useState("");
    const [slots, setSlots] = React.useState<DraftSlot[]>(() => {
        if (editData) {
            return editData.slots
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder || a.startsAt - b.startsAt)
                .map((s) => {
                    editKeyCounter += 1;
                    return {
                        key: `edit-${editKeyCounter}`,
                        id: s.id,
                        startMin: msToMinutes(s.startsAt, editData.date),
                        endMin: msToMinutes(s.endsAt, editData.date),
                        role: s.role,
                        place: s.place ?? "",
                        capacity: s.capacity,
                    };
                });
        }
        return [newDraftSlot(9 * 60, 120)];
    });

    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const handleSubmit = async () => {
        setError(null);
        const trimmedTitle = title.trim();
        if (!trimmedTitle) return setError("タイトルを入力してください。");
        const date = parseDateInput(dateStr);
        if (date === null) return setError("対象日を選択してください。");
        if (!isEdit && adminPassword.length < 8)
            return setError("管理パスワードは 8 文字以上で設定してください。");
        const cleanSlots = slots.filter((s) => s.role.trim() !== "");
        if (cleanSlots.length === 0)
            return setError("役割を入力したシフト枠を 1 つ以上作成してください。");
        for (const s of cleanSlots) {
            if (s.endMin <= s.startMin)
                return setError(`「${s.role}」の終了時刻は開始時刻より後にしてください。`);
        }

        const payloadSlots = cleanSlots.map((s, i) => ({
            ...(s.id ? { id: s.id } : {}),
            startsAt: minutesToMs(s.startMin, date),
            endsAt: minutesToMs(s.endMin, date),
            role: s.role.trim(),
            place: s.place.trim(),
            capacity: s.capacity,
            sortOrder: i,
        }));

        setSubmitting(true);
        try {
            if (isEdit) {
                const res = await fetch(`/api/shifts/${editData!.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: trimmedTitle,
                        description,
                        date,
                        slots: payloadSlots,
                    }),
                });
                if (!res.ok) {
                    const data = (await res.json().catch(() => ({}))) as { error?: string };
                    throw new Error(data.error ?? "更新に失敗しました。");
                }
                router.push(`/shifts/${editData!.id}/admin`);
            } else {
                const res = await fetch("/api/shifts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: trimmedTitle,
                        description,
                        date,
                        slots: payloadSlots,
                        adminPassword,
                        creatorUserId: userId ?? undefined,
                    }),
                });
                if (!res.ok) {
                    const data = (await res.json().catch(() => ({}))) as { error?: string };
                    throw new Error(data.error ?? "作成に失敗しました。");
                }
                const data = (await res.json()) as { id: string };
                router.push(`/shifts/${data.id}/admin`);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "エラーが発生しました。");
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
            <div className="space-y-1">
                <h1 className="flex items-center gap-2 text-2xl font-bold">
                    <CalendarClock className="size-6 text-primary" />
                    {isEdit ? "シフト表を編集" : "シフト表を作成"}
                </h1>
                <p className="text-sm text-muted-foreground">
                    1 日分のシフト枠を作成します。前日準備の日も、その日付で別の表を作るだけです。
                </p>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="space-y-4">
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">タイトル</label>
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="例: 技大祭 前日準備シフト"
                        maxLength={200}
                    />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">対象日</label>
                        <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
                    </div>
                    {!isEdit && (
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium">管理パスワード（8文字以上）</label>
                            <Input
                                type="password"
                                value={adminPassword}
                                onChange={(e) => setAdminPassword(e.target.value)}
                                placeholder="管理画面のログインに使用"
                                autoComplete="new-password"
                            />
                        </div>
                    )}
                </div>

                <div className="space-y-1.5">
                    <label className="text-sm font-medium">説明（任意）</label>
                    <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="集合場所や持ち物など"
                        rows={2}
                        maxLength={2000}
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">シフト枠</label>
                    <p className="text-xs text-muted-foreground">
                        バーの中央をドラッグで移動、左右の端をドラッグで開始・終了を調整できます。
                    </p>
                    <ShiftTimelineEditor slots={slots} onChange={setSlots} />
                </div>
            </div>

            <div className="flex justify-end gap-2">
                <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
                    {submitting && <Loader2 className="size-4 animate-spin" />}
                    {isEdit ? "更新する" : "作成する"}
                </Button>
            </div>
        </div>
    );
}
