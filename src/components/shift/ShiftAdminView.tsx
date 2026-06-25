"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Loader2,
    AlertCircle,
    AlertTriangle,
    Eye,
    EyeOff,
    Save,
    Trash2,
    Link2,
    Check,
    Ban,
    Wand2,
    Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    DAY_MS,
    boardDays,
    dayIndexOf,
    dayMinToMs,
    msToDayMin,
    formatMinutes,
    formatDay,
    rangesOverlap,
    slotIsNg,
    type ShiftAdminView as AdminView,
} from "@/lib/shift";
import { ShiftLaneGantt, type Lane } from "./ShiftLaneGantt";

type Phase = "loading" | "auth" | "ready" | "error";

const laneId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `lane-${Math.random()}`;

export function ShiftAdminView({ boardId }: { boardId: string }) {
    const [phase, setPhase] = React.useState<Phase>("loading");
    const [data, setData] = React.useState<AdminView | null>(null);
    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

    const [dayLanes, setDayLanes] = React.useState<Record<number, Lane[]>>({});
    const [assign, setAssign] = React.useState<Map<string, Set<string>>>(new Map());
    const [dirty, setDirty] = React.useState(false);

    const [password, setPassword] = React.useState("");
    const [authError, setAuthError] = React.useState<string | null>(null);
    const [authing, setAuthing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [publishing, setPublishing] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const [activeDay, setActiveDay] = React.useState(0);

    const hydrate = (view: AdminView) => {
        const byDay: Record<number, Map<string, Lane>> = {};
        const sorted = [...view.slots].sort((a, b) => a.sortOrder - b.sortOrder || a.startsAt - b.startsAt);
        for (const s of sorted) {
            const di = dayIndexOf(s.startsAt, view.board.startDate);
            const mid = view.board.startDate + di * DAY_MS;
            (byDay[di] ??= new Map<string, Lane>());
            const laneMap = byDay[di];
            if (!laneMap.has(s.role)) laneMap.set(s.role, { laneId: laneId(), role: s.role, segments: [] });
            laneMap.get(s.role)!.segments.push({
                id: s.id,
                startMin: msToDayMin(s.startsAt, mid),
                endMin: msToDayMin(s.endsAt, mid),
                place: s.place ?? "",
                capacity: s.capacity,
            });
        }
        const lanesByDay: Record<number, Lane[]> = {};
        for (const di of Object.keys(byDay)) lanesByDay[Number(di)] = [...byDay[Number(di)].values()];
        setDayLanes(lanesByDay);

        const m = new Map<string, Set<string>>();
        for (const a of view.assignments) {
            const set = m.get(a.slotId) ?? new Set<string>();
            set.add(a.memberId);
            m.set(a.slotId, set);
        }
        setAssign(m);
        setDirty(false);
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
            hydrate(view);
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

    const setLanesForDay = (di: number, lanes: Lane[]) => {
        setDayLanes((prev) => ({ ...prev, [di]: lanes }));
        setDirty(true);
    };

    const toggleAssign = (segId: string, memberId: string) => {
        setAssign((prev) => {
            const next = new Map(prev);
            const set = new Set(next.get(segId) ?? []);
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- JS Set, not a Drizzle query
            if (set.has(memberId)) set.delete(memberId);
            else set.add(memberId);
            next.set(segId, set);
            return next;
        });
        setDirty(true);
    };

    const save = React.useCallback(async () => {
        if (!data) return;
        setSaving(true);
        try {
            const days = boardDays(data.board);
            const payloadSlots: {
                id: string;
                startsAt: number;
                endsAt: number;
                role: string;
                place: string;
                capacity: number;
                sortOrder: number;
            }[] = [];
            const liveIds = new Set<string>();
            let order = 0;
            for (const diStr of Object.keys(dayLanes)) {
                const di = Number(diStr);
                if (di >= days.length) continue;
                const mid = days[di];
                for (const lane of dayLanes[di]) {
                    for (const seg of lane.segments) {
                        liveIds.add(seg.id);
                        payloadSlots.push({
                            id: seg.id,
                            startsAt: dayMinToMs(mid, seg.startMin),
                            endsAt: dayMinToMs(mid, seg.endMin),
                            role: lane.role.trim() || "シフト",
                            place: seg.place.trim(),
                            capacity: seg.capacity,
                            sortOrder: order++,
                        });
                    }
                }
            }
            const slotRes = await fetch(`/api/shifts/${boardId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slots: payloadSlots }),
            });
            if (!slotRes.ok) throw new Error();

            const pairs: { slotId: string; memberId: string }[] = [];
            for (const [segId, set] of assign) {
                if (!liveIds.has(segId)) continue;
                for (const memberId of set) pairs.push({ slotId: segId, memberId });
            }
            const asgRes = await fetch(`/api/shifts/${boardId}/assignments`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignments: pairs }),
            });
            if (!asgRes.ok) throw new Error();
            setDirty(false);
        } catch {
            setErrorMsg("保存に失敗しました。");
        } finally {
            setSaving(false);
        }
    }, [data, dayLanes, assign, boardId]);

    const togglePublish = async () => {
        if (!data) return;
        const next = data.board.status !== "published";
        if (next && dirty) await save();
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
        if (res.ok) window.location.href = "/shifts";
        else setErrorMsg("削除に失敗しました。");
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

    const { board, members } = data;
    const days = boardDays(board);
    const isPublished = board.status === "published";
    const day = Math.min(activeDay, Math.max(0, days.length - 1));

    // 全区分の絶対時間・定員・役割（割当の NG/重複/容量判定に使う）。
    const segInfo = new Map<string, { startsAt: number; endsAt: number; capacity: number; role: string }>();
    for (const diStr of Object.keys(dayLanes)) {
        const di = Number(diStr);
        if (di >= days.length) continue;
        const mid = days[di];
        for (const lane of dayLanes[di]) {
            for (const seg of lane.segments) {
                segInfo.set(seg.id, {
                    startsAt: dayMinToMs(mid, seg.startMin),
                    endsAt: dayMinToMs(mid, seg.endMin),
                    capacity: seg.capacity,
                    role: lane.role,
                });
            }
        }
    }

    const memberById = new Map(members.map((m) => [m.id, m]));
    const load_ = new Map<string, number>();
    const memberSegs = new Map<string, string[]>();
    for (const [segId, set] of assign) {
        if (!segInfo.has(segId)) continue;
        for (const mid of set) {
            load_.set(mid, (load_.get(mid) ?? 0) + 1);
            (memberSegs.get(mid) ?? memberSegs.set(mid, []).get(mid)!).push(segId);
        }
    }
    const conflictAt = (segId: string, memberId: string): boolean => {
        const info = segInfo.get(segId);
        if (!info) return false;
        return (memberSegs.get(memberId) ?? []).some((other) => {
            if (other === segId) return false;
            const o = segInfo.get(other);
            return o ? rangesOverlap(info.startsAt, info.endsAt, o.startsAt, o.endsAt) : false;
        });
    };

    const runAutoAssign = () => {
        const ordered = [...segInfo.entries()].sort((a, b) => a[1].startsAt - b[1].startsAt);
        const ld = new Map<string, number>(members.map((m) => [m.id, 0]));
        const spans = new Map<string, { s: number; e: number }[]>();
        const next = new Map<string, Set<string>>();
        for (const [segId, info] of ordered) {
            const cands = members
                .filter((m) => !slotIsNg({ startsAt: info.startsAt, endsAt: info.endsAt }, m.unavailableRanges))
                .filter((m) => !(spans.get(m.id) ?? []).some((sp) => rangesOverlap(info.startsAt, info.endsAt, sp.s, sp.e)))
                .sort((x, y) => (ld.get(x.id)! - ld.get(y.id)!));
            const set = new Set<string>();
            for (const m of cands.slice(0, info.capacity)) {
                set.add(m.id);
                ld.set(m.id, ld.get(m.id)! + 1);
                (spans.get(m.id) ?? spans.set(m.id, []).get(m.id)!).push({ s: info.startsAt, e: info.endsAt });
            }
            next.set(segId, set);
        }
        setAssign(next);
        setDirty(true);
    };

    // 警告（時間重複の二重割当・NG時間帯への割当）。
    const overlapWarnings: string[] = [];
    const ngWarnings: string[] = [];
    for (const m of members) {
        const segs = (memberSegs.get(m.id) ?? []).map((id) => ({ id, info: segInfo.get(id)! })).filter((x) => x.info);
        segs.sort((a, b) => a.info.startsAt - b.info.startsAt);
        for (let i = 0; i < segs.length; i++) {
            if (slotIsNg({ startsAt: segs[i].info.startsAt, endsAt: segs[i].info.endsAt }, m.unavailableRanges))
                ngWarnings.push(`${m.name}: NG時間帯に割当（${segs[i].info.role}）`);
            for (let j = i + 1; j < segs.length; j++)
                if (rangesOverlap(segs[i].info.startsAt, segs[i].info.endsAt, segs[j].info.startsAt, segs[j].info.endsAt))
                    overlapWarnings.push(`${m.name}: 時間が重なる割当（${segs[i].info.role} / ${segs[j].info.role}）`);
        }
    }

    const assignedCount = (segId: string) => assign.get(segId)?.size ?? 0;

    const renderSegmentAssign = (segId: string) => {
        const info = segInfo.get(segId);
        if (!info) return null;
        const assigned = assign.get(segId) ?? new Set<string>();
        const over = assigned.size > info.capacity;
        const byDept = new Map<string, typeof members>();
        for (const m of members) {
            const key = m.department && m.department.length > 0 ? m.department : "（部署なし）";
            (byDept.get(key) ?? byDept.set(key, []).get(key)!).push(m);
        }
        const deptNames = [...byDept.keys()].sort((a, b) => a.localeCompare(b, "ja"));
        const isNg = (mid: string) => {
            const m = memberById.get(mid);
            return m ? slotIsNg({ startsAt: info.startsAt, endsAt: info.endsAt }, m.unavailableRanges) : false;
        };
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">この時間に割り当てるメンバー</span>
                    <span className={cn("flex items-center gap-1 text-xs", over ? "text-amber-600" : "text-muted-foreground")}>
                        <Users className="size-3" />
                        {assigned.size}/{info.capacity}
                    </span>
                </div>
                {members.length === 0 && <p className="text-xs text-muted-foreground">回答メンバーがいません。</p>}
                {deptNames.map((dept) => {
                    const ms = byDept.get(dept)!.slice().sort((a, b) => Number(isNg(a.id)) - Number(isNg(b.id)));
                    return (
                        <div key={dept}>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">{dept}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {ms.map((m) => {
                                    const ng = isNg(m.id);
                                    const on = assigned.has(m.id);
                                    const conflict = on && conflictAt(segId, m.id);
                                    return (
                                        <button
                                            type="button"
                                            key={m.id}
                                            disabled={ng && !on}
                                            onClick={() => toggleAssign(segId, m.id)}
                                            title={ng ? "本人の NG 時間帯と重なる" : undefined}
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
        );
    };

    return (
        <div className="w-full space-y-6 px-6 py-10 lg:px-12">
            <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold">{board.title}</h1>
                    <span
                        className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            isPublished ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"
                        )}
                    >
                        {isPublished ? "公開済み" : "募集中"}
                    </span>
                </div>
                <p className="text-sm text-muted-foreground">
                    {board.startDate === board.endDate
                        ? formatDay(board.startDate)
                        : `${formatDay(board.startDate)} 〜 ${formatDay(board.endDate)}`}{" "}
                    ・ {formatMinutes(board.dayStartMin)}–{formatMinutes(board.dayEndMin)} ・ 回答 {members.length} 名
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={runAutoAssign} className="gap-1" disabled={segInfo.size === 0}>
                        <Wand2 className="size-4" /> 自動割当
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1">
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        {dirty ? "保存" : "保存済み"}
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
                    <Button variant="outline" size="sm" onClick={copyShareLink} className="gap-1">
                        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
                        {copied ? "コピーしました" : "共有リンク"}
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

            {(overlapWarnings.length > 0 || ngWarnings.length > 0) && (
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
                    <div className="flex items-center gap-1.5 font-medium">
                        <AlertTriangle className="size-4" /> 割当の警告
                    </div>
                    {[...new Set([...overlapWarnings, ...ngWarnings])].map((w, i) => (
                        <div key={i}>{w}</div>
                    ))}
                </div>
            )}

            {days.length > 1 && (
                <div className="flex flex-wrap gap-1">
                    {days.map((d, i) => (
                        <button
                            type="button"
                            key={d}
                            onClick={() => setActiveDay(i)}
                            className={cn(
                                "rounded-md border px-2.5 py-1 text-xs",
                                i === day ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"
                            )}
                        >
                            {formatDay(d)}
                            <span className="ml-1 opacity-70">({(dayLanes[i] ?? []).length}行)</span>
                        </button>
                    ))}
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                1 行 = 役割。行に時間区分を横に並べます（例: 受付 = 10:00–11:00, 11:00–12:00…）。
                バーはドラッグで移動・端で時間調整、<b>クリックで時間編集とメンバー割当</b>。
            </p>

            <ShiftLaneGantt
                axisStartMin={board.dayStartMin}
                axisEndMin={board.dayEndMin}
                lanes={dayLanes[day] ?? []}
                onChange={(lanes) => setLanesForDay(day, lanes)}
                assignedCount={assignedCount}
                renderSegmentAssign={renderSegmentAssign}
            />
        </div>
    );
}
