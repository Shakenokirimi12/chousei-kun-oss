"use client";

import * as React from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Loader2,
    AlertCircle,
    Users,
    MapPin,
    Wand2,
    Save,
    Eye,
    EyeOff,
    Pencil,
    Trash2,
    Link2,
    Check,
    Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateLabel } from "@/lib/officeHour";
import { formatMinutes, msToMinutes, rangesOverlap, type ShiftAdminView as AdminView } from "@/lib/shift";

type Phase = "loading" | "auth" | "ready" | "error";

export function ShiftAdminView({ boardId }: { boardId: string }) {
    const [phase, setPhase] = React.useState<Phase>("loading");
    const [data, setData] = React.useState<AdminView | null>(null);
    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

    // 割当: slotId -> Set<memberId>
    const [assign, setAssign] = React.useState<Map<string, Set<string>>>(new Map());
    const [dirty, setDirty] = React.useState(false);

    const [password, setPassword] = React.useState("");
    const [authError, setAuthError] = React.useState<string | null>(null);
    const [authing, setAuthing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [publishing, setPublishing] = React.useState(false);
    const [autoLoading, setAutoLoading] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    const buildAssignMap = (view: AdminView) => {
        const m = new Map<string, Set<string>>();
        for (const a of view.assignments) {
            const set = m.get(a.slotId) ?? new Set<string>();
            set.add(a.memberId);
            m.set(a.slotId, set);
        }
        return m;
    };

    const load = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/shifts/${boardId}/admin`);
            if (res.status === 401) {
                setPhase("auth");
                return;
            }
            if (!res.ok) {
                setErrorMsg("読み込みに失敗しました。");
                setPhase("error");
                return;
            }
            const view = (await res.json()) as AdminView;
            setData(view);
            setAssign(buildAssignMap(view));
            setDirty(false);
            setPhase("ready");
        } catch {
            setErrorMsg("読み込みに失敗しました。");
            setPhase("error");
        }
    }, [boardId]);

    React.useEffect(() => {
        load();
    }, [load]);

    const handleAuth = async () => {
        setAuthError(null);
        setAuthing(true);
        try {
            const res = await fetch(`/api/shifts/${boardId}/admin-auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                const d = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(d.error === "Invalid password" ? "パスワードが違います。" : d.error ?? "失敗しました。");
            }
            setPassword("");
            setPhase("loading");
            await load();
        } catch (e) {
            setAuthError(e instanceof Error ? e.message : "エラーが発生しました。");
        } finally {
            setAuthing(false);
        }
    };

    const toggleAssign = (slotId: string, memberId: string) => {
        setAssign((prev) => {
            const next = new Map(prev);
            const set = new Set(next.get(slotId) ?? []);
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- JS Set, not a Drizzle query
            if (set.has(memberId)) set.delete(memberId);
            else set.add(memberId);
            next.set(slotId, set);
            return next;
        });
        setDirty(true);
    };

    const runAutoAssign = async () => {
        setAutoLoading(true);
        try {
            const res = await fetch(`/api/shifts/${boardId}/auto-assign`, { method: "POST" });
            if (!res.ok) throw new Error();
            const { assignments } = (await res.json()) as {
                assignments: { slotId: string; memberId: string }[];
            };
            const m = new Map<string, Set<string>>();
            for (const a of assignments) {
                const set = m.get(a.slotId) ?? new Set<string>();
                set.add(a.memberId);
                m.set(a.slotId, set);
            }
            setAssign(m);
            setDirty(true);
        } catch {
            setErrorMsg("自動割当に失敗しました。");
        } finally {
            setAutoLoading(false);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const pairs: { slotId: string; memberId: string }[] = [];
            for (const [slotId, set] of assign) {
                for (const memberId of set) pairs.push({ slotId, memberId });
            }
            const res = await fetch(`/api/shifts/${boardId}/assignments`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignments: pairs }),
            });
            if (!res.ok) throw new Error();
            setDirty(false);
        } catch {
            setErrorMsg("保存に失敗しました。");
        } finally {
            setSaving(false);
        }
    };

    const togglePublish = async () => {
        if (!data) return;
        const next = data.board.status !== "published";
        if (next && dirty) {
            // 公開前に未保存の割当があれば先に保存する。
            await save();
        }
        setPublishing(true);
        try {
            const res = await fetch(`/api/shifts/${boardId}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ published: next }),
            });
            if (!res.ok) throw new Error();
            setData({ ...data, board: { ...data.board, status: next ? "published" : "collecting" } });
        } catch {
            setErrorMsg("公開状態の変更に失敗しました。");
        } finally {
            setPublishing(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm("このシフト表を削除しますか？この操作は元に戻せません。")) return;
        const res = await fetch(`/api/shifts/${boardId}`, { method: "DELETE" });
        if (res.ok) {
            window.location.href = "/shifts";
        } else {
            setErrorMsg("削除に失敗しました。");
        }
    };

    const copyShareLink = async () => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}/shifts/${boardId}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* ignore */
        }
    };

    if (phase === "loading") {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (phase === "auth") {
        return (
            <div className="mx-auto max-w-sm space-y-4 px-4 py-16">
                <h1 className="text-xl font-bold">管理者ログイン</h1>
                <Input
                    type="password"
                    placeholder="管理パスワード"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                />
                {authError && (
                    <p className="flex items-center gap-1.5 text-sm text-destructive">
                        <AlertCircle className="size-4" />
                        {authError}
                    </p>
                )}
                <Button onClick={handleAuth} disabled={authing} className="w-full gap-2">
                    {authing && <Loader2 className="size-4 animate-spin" />}
                    ログイン
                </Button>
            </div>
        );
    }

    if (phase === "error" || !data) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-16 text-center">
                <AlertCircle className="mx-auto size-10 text-muted-foreground" />
                <p className="mt-3 text-muted-foreground">{errorMsg ?? "エラーが発生しました。"}</p>
            </div>
        );
    }

    const { board, slots, members } = data;
    const orderedSlots = [...slots].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.startsAt - b.startsAt
    );
    const isPublished = board.status === "published";

    // 各メンバーの現在割当数（負荷バランスの目安）。
    const load_ = new Map<string, number>();
    for (const set of assign.values()) {
        for (const mid of set) load_.set(mid, (load_.get(mid) ?? 0) + 1);
    }

    // メンバーの時間重複検出（同一メンバーが重なる枠に割り当てられていないか）。
    const memberSlots = new Map<string, string[]>();
    for (const [slotId, set] of assign) {
        for (const mid of set) {
            const arr = memberSlots.get(mid) ?? [];
            arr.push(slotId);
            memberSlots.set(mid, arr);
        }
    }
    const slotById = new Map(orderedSlots.map((s) => [s.id, s]));
    const hasTimeConflict = (slotId: string, memberId: string): boolean => {
        const s = slotById.get(slotId);
        if (!s) return false;
        return (memberSlots.get(memberId) ?? []).some((other) => {
            if (other === slotId) return false;
            const o = slotById.get(other);
            return o ? rangesOverlap(s.startsAt, s.endsAt, o.startsAt, o.endsAt) : false;
        });
    };

    return (
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
            <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold">{board.title}</h1>
                    <span
                        className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            isPublished
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-amber-500/15 text-amber-700"
                        )}
                    >
                        {isPublished ? "公開済み" : "募集中"}
                    </span>
                </div>
                <p className="text-sm text-muted-foreground">
                    {formatDateLabel(board.date)} ・ 回答 {members.length} 名
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={copyShareLink} className="gap-1">
                        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
                        {copied ? "コピーしました" : "共有リンク"}
                    </Button>
                    <Button variant="outline" size="sm" asChild className="gap-1">
                        <Link href={`/shifts/${boardId}/edit`}>
                            <Pencil className="size-4" /> 枠を編集
                        </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDelete} className="gap-1 text-destructive">
                        <Trash2 className="size-4" /> 削除
                    </Button>
                </div>
            </header>

            {errorMsg && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle className="size-4" />
                    {errorMsg}
                </div>
            )}

            {members.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    まだ回答がありません。共有リンクをメンバーに配布してください。
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={runAutoAssign}
                            disabled={autoLoading}
                            className="gap-1"
                        >
                            {autoLoading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                            自動割当（提案）
                        </Button>
                        <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1">
                            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            {dirty ? "割当を保存" : "保存済み"}
                        </Button>
                        <Button
                            variant={isPublished ? "outline" : "default"}
                            size="sm"
                            onClick={togglePublish}
                            disabled={publishing}
                            className="gap-1"
                        >
                            {publishing ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : isPublished ? (
                                <EyeOff className="size-4" />
                            ) : (
                                <Eye className="size-4" />
                            )}
                            {isPublished ? "非公開に戻す" : "公開する"}
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        各枠でメンバーをタップして割当します。
                        <Ban className="mx-1 inline size-3 text-destructive" />
                        は本人が「出られない」とした枠で、割当できません。背景が黄色は時間が重複している警告です。
                    </p>

                    <div className="space-y-3">
                        {orderedSlots.map((s) => {
                            const assigned = assign.get(s.id) ?? new Set<string>();
                            const over = assigned.size > s.capacity;
                            return (
                                <div key={s.id} className="rounded-lg border p-3">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="font-medium">
                                            {s.role}
                                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                {formatMinutes(msToMinutes(s.startsAt, board.date))}–
                                                {formatMinutes(msToMinutes(s.endsAt, board.date))}
                                                {s.place && (
                                                    <>
                                                        {" ・ "}
                                                        <MapPin className="inline size-3" /> {s.place}
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                        <span
                                            className={cn(
                                                "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
                                                over
                                                    ? "bg-amber-500/15 text-amber-700"
                                                    : "bg-muted text-muted-foreground"
                                            )}
                                        >
                                            <Users className="size-3" />
                                            {assigned.size}/{s.capacity}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {members.map((m) => {
                                            const ng = m.unavailableSlotIds.includes(s.id);
                                            const on = assigned.has(m.id);
                                            const conflict = on && hasTimeConflict(s.id, m.id);
                                            return (
                                                <button
                                                    type="button"
                                                    key={m.id}
                                                    disabled={ng && !on}
                                                    onClick={() => toggleAssign(s.id, m.id)}
                                                    title={ng ? "本人が出られないと回答" : undefined}
                                                    className={cn(
                                                        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                                                        ng && !on && "cursor-not-allowed border-destructive/30 bg-destructive/5 text-destructive/60 line-through",
                                                        on && !conflict && "border-primary bg-primary text-primary-foreground",
                                                        on && conflict && "border-amber-500 bg-amber-400/80 text-amber-950",
                                                        !on && !ng && "border-border bg-background hover:border-primary/50 hover:bg-accent"
                                                    )}
                                                >
                                                    {ng && <Ban className="size-3" />}
                                                    {m.name}
                                                    <span className="opacity-60">({load_.get(m.id) ?? 0})</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
