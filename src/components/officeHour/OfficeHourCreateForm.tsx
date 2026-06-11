"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Calendar as CalendarIcon, Sparkles, AlertCircle, Plus, X, GraduationCap, CheckCircle2, Copy, Check, ExternalLink, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEEKDAYS_JP, parseDateInput, formatIsoDate } from "@/lib/officeHour";
import type { GoogleSessionStatus } from "@/types";
import { SchedulePreview } from "./SchedulePreview";
import { useUser } from "@/hooks/useUser";

type TimeRange = {
    start: string;
    end: string;
};

type DayConfig = {
    enabled: boolean;
    ranges: TimeRange[];
};

const DEFAULT_RANGE: TimeRange = { start: "13:00", end: "17:00" };
const CACHE_KEY = "officeHourCreationCache";

export type EditData = {
    id: string;
    title: string;
    description: string | null;
    startDate: number | null;
    endDate: number | null;
    windows: { day: number; start: string; end: string }[];
    slotDurationMin: number;
    capacityPerSlot: number;
    bufferMin: number;
};

function windowsToDays(windows: { day: number; start: string; end: string }[]): DayConfig[] {
    const days: DayConfig[] = Array.from({ length: 7 }, () => ({ enabled: false, ranges: [{ ...DEFAULT_RANGE }] }));
    for (const w of windows) {
        if (w.day < 0 || w.day > 6) continue;
        if (!days[w.day].enabled) {
            days[w.day].enabled = true;
            days[w.day].ranges = [{ start: w.start, end: w.end }];
        } else {
            days[w.day].ranges.push({ start: w.start, end: w.end });
        }
    }
    return days;
}

type FormCache = {
    title: string;
    description: string;
    startDate: string;
    endDate: string;
    openEnded: boolean;
    days: DayConfig[];
    slotDurationMin: number;
    capacityPerSlot: number;
    bufferMin: number;
    adminPassword: string;
    campusIcalUrl: string | null;
    campusEventCount: number | null;
};

function loadCache(): Partial<FormCache> | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as Partial<FormCache>;
    } catch {
        return null;
    }
}

export function OfficeHourCreateForm({ editData }: { editData?: EditData } = {}) {
    const isEdit = !!editData;
    const { userId } = useUser();
    const [createdId, setCreatedId] = React.useState<string | null>(null);
    const [googleStatus, setGoogleStatus] = React.useState<GoogleSessionStatus | null>(null);
    const [isLoadingStatus, setIsLoadingStatus] = React.useState(!isEdit);
    const [editSaved, setEditSaved] = React.useState(false);

    // フォーム状態（編集時は editData から、新規時は localStorage から復元）
    const cached = React.useMemo(() => isEdit ? null : loadCache(), [isEdit]);
    const [title, setTitle] = React.useState(editData?.title ?? cached?.title ?? "");
    const [description, setDescription] = React.useState(editData?.description ?? cached?.description ?? "");
    const [startDate, setStartDate] = React.useState(() =>
        editData?.startDate != null ? formatIsoDate(editData.startDate) : (cached?.startDate ?? "")
    );
    const [endDate, setEndDate] = React.useState(() =>
        editData?.endDate != null ? formatIsoDate(editData.endDate) : (cached?.endDate ?? "")
    );
    const [openEnded, setOpenEnded] = React.useState(() =>
        editData ? (editData.startDate === null && editData.endDate === null) : (cached?.openEnded ?? false)
    );
    const [days, setDays] = React.useState<DayConfig[]>(() =>
        editData ? windowsToDays(editData.windows) : (cached?.days ?? Array.from({ length: 7 }, (_, i) => ({
            enabled: i >= 1 && i <= 5,
            ranges: [{ ...DEFAULT_RANGE }],
        })))
    );
    const [slotDurationMin, setSlotDurationMin] = React.useState(editData?.slotDurationMin ?? cached?.slotDurationMin ?? 30);
    const [capacityPerSlot, setCapacityPerSlot] = React.useState(editData?.capacityPerSlot ?? cached?.capacityPerSlot ?? 1);
    const [bufferMin, setBufferMin] = React.useState(editData?.bufferMin ?? cached?.bufferMin ?? 0);
    const [campusUid, setCampusUid] = React.useState("");
    const [campusPass, setCampusPass] = React.useState("");
    const [campusIcalUrl, setCampusIcalUrl] = React.useState<string | null>(isEdit ? "existing" : (cached?.campusIcalUrl ?? null));
    const [campusSyncing, setCampusSyncing] = React.useState(false);
    const [campusError, setCampusError] = React.useState<string | null>(null);
    const [campusEventCount, setCampusEventCount] = React.useState<number | null>(isEdit ? 0 : (cached?.campusEventCount ?? null));
    const [adminPassword, setAdminPassword] = React.useState(isEdit ? "________" : (cached?.adminPassword ?? ""));

    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/google/session-status");
                if (!res.ok) throw new Error("status fetch failed");
                const data = (await res.json()) as GoogleSessionStatus;
                setGoogleStatus(data);
            } catch {
                setGoogleStatus({ hasSession: false, email: null, hasCalendarReadScope: false, hasCalendarWriteScope: false, hasUserId: false });
            } finally {
                setIsLoadingStatus(false);
            }
        })();
    }, []);

    const updateDay = (i: number, patch: Partial<DayConfig>) => {
        setDays((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
    };

    const updateRange = (dayIdx: number, rangeIdx: number, patch: Partial<TimeRange>) => {
        setDays((prev) =>
            prev.map((d, di) =>
                di === dayIdx
                    ? { ...d, ranges: d.ranges.map((r, ri) => (ri === rangeIdx ? { ...r, ...patch } : r)) }
                    : d
            )
        );
    };

    const addRange = (dayIdx: number) => {
        setDays((prev) =>
            prev.map((d, di) =>
                di === dayIdx ? { ...d, ranges: [...d.ranges, { ...DEFAULT_RANGE }] } : d
            )
        );
    };

    const removeRange = (dayIdx: number, rangeIdx: number) => {
        setDays((prev) =>
            prev.map((d, di) =>
                di === dayIdx ? { ...d, ranges: d.ranges.filter((_, ri) => ri !== rangeIdx) } : d
            )
        );
    };

    const saveCache = React.useCallback(() => {
        try {
            const data: FormCache = {
                title, description, startDate, endDate, openEnded, days,
                slotDurationMin, capacityPerSlot, bufferMin, adminPassword,
                campusIcalUrl, campusEventCount,
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch { /* quota exceeded etc. */ }
    }, [title, description, startDate, endDate, openEnded, days, slotDurationMin, capacityPerSlot, bufferMin, adminPassword, campusIcalUrl, campusEventCount]);

    React.useEffect(() => { saveCache(); }, [days, openEnded, saveCache]);

    const [copyMenuOpen, setCopyMenuOpen] = React.useState<number | null>(null);

    const copyRangesToDays = (sourceIdx: number, targetIndices: number[]) => {
        setDays((prev) => {
            const sourceRanges = prev[sourceIdx].ranges.map((r) => ({ ...r }));
            return prev.map((d, i) =>
                targetIndices.includes(i) ? { ...d, enabled: true, ranges: sourceRanges.map((r) => ({ ...r })) } : d
            );
        });
        setCopyMenuOpen(null);
    };

    const handleCampusSync = async () => {
        if (!campusUid.trim() || !campusPass) return;
        setCampusSyncing(true);
        setCampusError(null);
        try {
            const res = await fetch("/api/sync-calendar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uid: campusUid.trim(), pass: campusPass }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error ?? "連携に失敗しました");
            }
            const data = (await res.json()) as { events?: unknown[]; icalUrl?: string };
            if (!data.icalUrl) throw new Error("カレンダーURLの取得に失敗しました");
            setCampusIcalUrl(data.icalUrl);
            setCampusEventCount(data.events?.length ?? 0);
        } catch (e) {
            setCampusError(e instanceof Error ? e.message : "連携に失敗しました");
        } finally {
            setCampusSyncing(false);
        }
    };

    const canSubmit = isEdit
        ? title.trim().length > 0 &&
          (openEnded || (startDate && endDate)) &&
          days.some((d) => d.enabled) &&
          slotDurationMin >= 5 &&
          capacityPerSlot >= 1
        : googleStatus?.hasSession === true &&
          title.trim().length > 0 &&
          (openEnded || (startDate && endDate)) &&
          days.some((d) => d.enabled) &&
          slotDurationMin >= 5 &&
          capacityPerSlot >= 1 &&
          campusIcalUrl !== null &&
          adminPassword.length >= 8;

    const windowsForPreview = React.useMemo(
        () => days.flatMap((d, idx) =>
            d.enabled ? d.ranges.map((r) => ({ day: idx, start: r.start, end: r.end })) : []
        ),
        [days]
    );

    const handleSubmit = async () => {
        setError(null);
        let startMs: number | null = null;
        let endMs: number | null = null;
        if (!openEnded) {
            startMs = parseDateInput(startDate);
            endMs = parseDateInput(endDate);
            if (startMs === null || endMs === null) {
                setError("日付の形式が正しくありません");
                return;
            }
            if (endMs < startMs) {
                setError("終了日は開始日より後にしてください");
                return;
            }
        }

        const windows: { day: number; start: string; end: string }[] = [];
        for (let idx = 0; idx < days.length; idx++) {
            const d = days[idx];
            if (!d.enabled) continue;
            for (const r of d.ranges) {
                windows.push({ day: idx, start: r.start, end: r.end });
            }
        }

        if (windows.length === 0) {
            setError("少なくとも1つ以上の曜日と時間帯を設定してください");
            return;
        }

        for (const w of windows) {
            const [sh, sm] = w.start.split(":").map(Number);
            const [eh, em] = w.end.split(":").map(Number);
            if (eh * 60 + em <= sh * 60 + sm) {
                setError(`${WEEKDAYS_JP[w.day]}曜日の時間帯が不正です（開始 < 終了 にしてください）`);
                return;
            }
        }

        setIsSubmitting(true);
        try {
            if (isEdit) {
                const res = await fetch(`/api/office-hours/${editData!.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: title.trim(),
                        description: description.trim() || undefined,
                        startDate: openEnded ? null : startMs,
                        endDate: openEnded ? null : endMs,
                        windows,
                        slotDurationMin,
                        capacityPerSlot,
                        bufferMin,
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({})) as { error?: string };
                    setError(data.error ?? "保存に失敗しました");
                    return;
                }
                setEditSaved(true);
                setTimeout(() => setEditSaved(false), 3000);
            } else {
                const res = await fetch("/api/office-hours", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: title.trim(),
                        description: description.trim() || undefined,
                        startDate: openEnded ? null : startMs,
                        endDate: openEnded ? null : endMs,
                        windows,
                        slotDurationMin,
                        capacityPerSlot,
                        bufferMin,
                        icalUrl: campusIcalUrl!,
                        adminPassword,
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({})) as { error?: string };
                    setError(data.error ?? "作成に失敗しました");
                    return;
                }
                const data = (await res.json()) as { id: string };
                localStorage.removeItem(CACHE_KEY);
                setCreatedId(data.id);
            }
        } catch (e) {
            console.error(e);
            setError("通信エラーが発生しました");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (createdId) {
        return <CreatedSuccess id={createdId} title={title} />;
    }

    if (isLoadingStatus) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> 状態を確認中...
            </div>
        );
    }

    if (!isEdit && !googleStatus?.hasSession) {
        const returnTo = "/office-hours/create";
        return (
            <div className="max-w-xl mx-auto py-12 px-4 space-y-6">
                <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Office Hour を作成</h1>
                    <p className="text-muted-foreground">
                        受付スケジュールを作成するには、まず主催者のGoogleカレンダー連携が必要です。
                    </p>
                </div>
                <div className="rounded-lg border bg-card/30 p-5 flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="text-sm">
                        <p className="font-medium">Googleカレンダー連携が必要です</p>
                        <p className="text-muted-foreground mt-1">
                            あなたの予定と重なる時間帯を自動で予約不可にするため、Googleアカウントの連携が必須となっています。
                        </p>
                    </div>
                </div>
                <Button asChild size="lg" className="w-full sm:w-auto gap-2">
                    <a href={`/api/google/auth/start?returnTo=${encodeURIComponent(returnTo)}${userId ? `&userId=${userId}` : ""}`}>
                        <CalendarIcon className="h-4 w-4" /> Googleアカウントを連携する
                    </a>
                </Button>
            </div>
        );
    }

    if (!isEdit && googleStatus?.hasSession && !googleStatus.hasUserId) {
        const returnTo = "/office-hours/create";
        return (
            <div className="max-w-xl mx-auto py-12 px-4 space-y-6">
                <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Office Hour を作成</h1>
                    <p className="text-muted-foreground">
                        ユーザー情報の紐付けが必要です。お手数ですが、一度ログアウトしてから再連携してください。
                    </p>
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" onClick={async () => {
                        await fetch("/api/google/logout", { method: "POST" });
                        window.location.reload();
                    }}>
                        ログアウト
                    </Button>
                    <Button asChild className="gap-2">
                        <a href={`/api/google/auth/start?returnTo=${encodeURIComponent(returnTo)}${userId ? `&userId=${userId}` : ""}`}>
                            <CalendarIcon className="h-4 w-4" /> 再連携する
                        </a>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full py-6 px-4 sm:px-6 lg:px-8">
            <div className="space-y-1.5 mb-6">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                    {isEdit ? "Office Hour の設定を編集" : "Office Hour を作成"}
                </h1>
                <p className="text-sm sm:text-base text-muted-foreground">
                    {isEdit
                        ? "設定を変更して「保存」を押してください。カレンダー連携とパスワードは変更できません。"
                        : "受付期間と時間帯を指定すると、空き枠が自動で生成されます。主催者の予定と重なる枠は自動で予約不可になります。"}
                </p>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8" onBlur={saveCache}>
                {/* 左カラム: 設定（固定幅、左寄せ） */}
                <div className="w-full lg:w-[420px] lg:shrink-0 space-y-6">
                    {/* タイトル */}
                    <Section title="基本情報">
                        <Field label="タイトル" required>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="例: 6月の研究相談" />
                        </Field>
                        <Field label="説明（任意）">
                            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="参加者へのメモなど" />
                        </Field>
                    </Section>

                    {/* 期間 */}
                    <Section title="受付期間">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={openEnded}
                                onChange={(e) => setOpenEnded(e.target.checked)}
                                className="h-4 w-4 accent-primary"
                            />
                            <span className="text-sm">受付期間を設けない（常時受付）</span>
                        </label>
                        <p className="text-xs text-muted-foreground">
                            ONにすると、開始日と終了日の指定なしで運用できます（直近{`${90}日`}分のスロットを生成）。
                        </p>
                        <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3", openEnded && "opacity-50 pointer-events-none")}>
                            <Field label="開始日" required={!openEnded}>
                                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={openEnded} />
                            </Field>
                            <Field label="終了日" required={!openEnded}>
                                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={openEnded} />
                            </Field>
                        </div>
                    </Section>

                    {/* 曜日別の受付時間帯 */}
                    <Section title="受付時間帯（曜日別）">
                        <p className="text-xs text-muted-foreground -mt-1 mb-2">利用したい曜日を ON にして、時間帯を指定してください。1日に複数の時間帯を設けられます。</p>
                        <div className="space-y-2">
                            {days.map((d, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "rounded-md border px-3 py-2 transition-colors",
                                        d.enabled ? "bg-card/40" : "bg-card/10 opacity-70"
                                    )}
                                >
                                    <div className="flex items-center gap-2 sm:gap-3">
                                        <label className="flex items-center gap-2 min-w-[64px] cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={d.enabled}
                                                onChange={(e) => updateDay(i, { enabled: e.target.checked })}
                                                className="h-4 w-4 accent-primary"
                                            />
                                            <span className="font-medium">{WEEKDAYS_JP[i]}</span>
                                        </label>
                                        {d.enabled && (
                                            <div className="relative ml-auto">
                                                <button
                                                    type="button"
                                                    onClick={() => setCopyMenuOpen(copyMenuOpen === i ? null : i)}
                                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
                                                    aria-label={`${WEEKDAYS_JP[i]}曜日の時間帯を他の曜日にコピー`}
                                                >
                                                    <Copy className="h-3 w-3" /> コピー
                                                </button>
                                                {copyMenuOpen === i && (
                                                    <CopyMenu
                                                        sourceIdx={i}
                                                        onCopy={copyRangesToDays}
                                                        onClose={() => setCopyMenuOpen(null)}
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {d.enabled && (
                                        <div className="mt-2 ml-8 space-y-1.5">
                                            {d.ranges.map((r, ri) => (
                                                <div key={ri} className="flex items-center gap-2">
                                                    <Input
                                                        type="time"
                                                        value={r.start}
                                                        onChange={(e) => updateRange(i, ri, { start: e.target.value })}
                                                        className="w-28"
                                                        aria-label={`${WEEKDAYS_JP[i]}曜日 時間帯${ri + 1} 開始`}
                                                    />
                                                    <span className="text-muted-foreground">〜</span>
                                                    <Input
                                                        type="time"
                                                        value={r.end === "24:00" ? "00:00" : r.end}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            updateRange(i, ri, { end: v === "00:00" ? "24:00" : v });
                                                        }}
                                                        className="w-28"
                                                        aria-label={`${WEEKDAYS_JP[i]}曜日 時間帯${ri + 1} 終了`}
                                                    />
                                                    {r.end === "24:00" && (
                                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">= 24:00</span>
                                                    )}
                                                    {d.ranges.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => removeRange(i, ri)}
                                                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                                            aria-label={`${WEEKDAYS_JP[i]}曜日 時間帯${ri + 1} を削除`}
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => addRange(i)}
                                                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mt-1"
                                            >
                                                <Plus className="h-3 w-3" /> 時間帯を追加
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* 枠設定 */}
                    <Section title="枠の設定">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <Field label="1枠の長さ" required>
                                <select
                                    value={slotDurationMin}
                                    onChange={(e) => setSlotDurationMin(Number(e.target.value))}
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                                        <option key={m} value={m}>
                                            {m}分
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="1枠の定員" required>
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={100}
                                    value={capacityPerSlot}
                                    onChange={(e) => setCapacityPerSlot(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                                />
                            </Field>
                            <Field label="バッファ（任意）">
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={120}
                                    value={bufferMin}
                                    onChange={(e) => setBufferMin(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
                                    aria-describedby="buffer-help"
                                />
                            </Field>
                        </div>
                        <p id="buffer-help" className="text-xs text-muted-foreground mt-1">
                            バッファは枠と枠の間に挿入される空き時間（分）です。0で連続枠。
                        </p>
                    </Section>

                    {/* 連携 (編集時は非表示) */}
                    {!isEdit && <Section title="主催者カレンダー連携">
                        <div className="rounded-md border bg-card/20 p-3 text-sm flex items-center gap-2">
                            <CalendarIcon className="h-4 w-4 text-green-500 shrink-0" aria-hidden="true" />
                            <span>Googleカレンダー: 連携済み（{googleStatus?.email}）</span>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <GraduationCap className="h-4 w-4" aria-hidden="true" />
                                大学カレンダー（CampusSquare）<span className="text-destructive">*</span>
                            </div>
                            {campusIcalUrl ? (
                                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" aria-hidden="true" />
                                    <span>連携済み（{campusEventCount}件の授業予定を取得）</span>
                                    <button
                                        type="button"
                                        onClick={() => { setCampusIcalUrl(null); setCampusEventCount(null); }}
                                        className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        再設定
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <Field label="学籍番号">
                                            <Input
                                                value={campusUid}
                                                onChange={(e) => setCampusUid(e.target.value)}
                                                placeholder="例: s1320000"
                                                autoComplete="username"
                                                disabled={campusSyncing}
                                            />
                                        </Field>
                                        <Field label="パスワード">
                                            <Input
                                                type="password"
                                                value={campusPass}
                                                onChange={(e) => setCampusPass(e.target.value)}
                                                autoComplete="current-password"
                                                disabled={campusSyncing}
                                            />
                                        </Field>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleCampusSync}
                                            disabled={campusSyncing || !campusUid.trim() || !campusPass}
                                            className="gap-2"
                                        >
                                            {campusSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="h-3.5 w-3.5" />}
                                            連携する
                                        </Button>
                                        <p className="text-xs text-muted-foreground">
                                            学籍番号・パスワードはカレンダーURL取得のみに使用し、保存しません。
                                        </p>
                                    </div>
                                    {campusError && (
                                        <div className="text-xs text-destructive flex items-start gap-1.5">
                                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                                            {campusError}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </Section>}

                    {/* 管理者 (編集時は非表示) */}
                    {!isEdit && <Section title="管理者設定">
                        <Field label="管理者パスワード" required>
                            <Input
                                type="password"
                                value={adminPassword}
                                onChange={(e) => setAdminPassword(e.target.value)}
                                placeholder="8文字以上"
                                minLength={8}
                                maxLength={256}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                予約状況を確認する管理画面で使用します。忘れないようにしてください。
                            </p>
                        </Field>
                    </Section>}

                    {error && (
                        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                            {error}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-2">
                        {editSaved && (
                            <span className="text-sm text-green-500 flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4" /> 保存しました
                            </span>
                        )}
                        {isEdit && (
                            <Button variant="outline" asChild>
                                <Link href={`/office-hours/${editData!.id}/admin`}>管理画面に戻る</Link>
                            </Button>
                        )}
                        <Button size="lg" className="gap-2" disabled={!canSubmit || isSubmitting} onClick={handleSubmit}>
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {isEdit ? "設定を保存" : "Office Hour を作成"}
                        </Button>
                    </div>
                </div>

                {/* 右カラム: プレビュー（残り全幅、sticky、ビューポート高さいっぱい）— 編集時は非表示 */}
                {!isEdit && (
                    <div className="flex-1 min-w-0">
                        <div className="lg:sticky lg:top-4 flex flex-col" style={{ height: "calc(100vh - 2rem)" }}>
                            <SchedulePreview
                                icalUrl={campusIcalUrl ?? ""}
                                windows={windowsForPreview}
                                slotDurationMin={slotDurationMin}
                                bufferMin={bufferMin}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
            <div className="space-y-3">{children}</div>
        </section>
    );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <label className="text-sm font-medium leading-none flex items-center gap-1.5">
                {label}
                {required && <span className="text-destructive">*</span>}
            </label>
            {children}
        </div>
    );
}

function CopyMenu({
    sourceIdx,
    onCopy,
    onClose,
}: {
    sourceIdx: number;
    onCopy: (sourceIdx: number, targetIndices: number[]) => void;
    onClose: () => void;
}) {
    const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const toggle = (idx: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const otherDays = Array.from({ length: 7 }, (_, i) => i).filter((i) => i !== sourceIdx);

    return (
        <div
            ref={ref}
            className="absolute right-0 top-full mt-1 z-20 rounded-md border bg-popover shadow-md p-2 min-w-[160px]"
        >
            <p className="text-[11px] text-muted-foreground mb-1.5 px-1">コピー先を選択</p>
            {otherDays.map((i) => (
                <label key={i} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-accent cursor-pointer select-none text-sm">
                    <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => toggle(i)}
                        className="h-3.5 w-3.5 accent-primary"
                    />
                    {WEEKDAYS_JP[i]}
                </label>
            ))}
            <div className="flex gap-1.5 mt-2 pt-1.5 border-t">
                <button
                    type="button"
                    onClick={() => setSelected(new Set(otherDays))}
                    className="text-[11px] text-primary hover:text-primary/80 px-1"
                >
                    全選択
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (selected.size > 0) onCopy(sourceIdx, Array.from(selected));
                    }}
                    disabled={selected.size === 0}
                    className="ml-auto text-[11px] font-medium bg-primary text-primary-foreground px-2 py-0.5 rounded disabled:opacity-40"
                >
                    適用
                </button>
            </div>
        </div>
    );
}

function CreatedSuccess({ id, title }: { id: string; title: string }) {
    const [copiedBooking, setCopiedBooking] = React.useState(false);
    const [copiedAdmin, setCopiedAdmin] = React.useState(false);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const bookingUrl = `${origin}/office-hours/${id}`;
    const adminUrl = `${origin}/office-hours/${id}/admin`;

    const copy = async (url: string, which: "booking" | "admin") => {
        await navigator.clipboard.writeText(url);
        if (which === "booking") {
            setCopiedBooking(true);
            setTimeout(() => setCopiedBooking(false), 2000);
        } else {
            setCopiedAdmin(true);
            setTimeout(() => setCopiedAdmin(false), 2000);
        }
    };

    return (
        <div className="max-w-xl mx-auto py-12 px-4 space-y-8">
            <div className="flex items-start gap-3">
                <CheckCircle2 className="h-7 w-7 text-green-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">作成完了</h1>
                    <p className="text-muted-foreground">
                        「{title}」の Office Hour を作成しました。
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <div className="rounded-lg border bg-card/30 p-4 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                        <Link2 className="h-4 w-4" /> 共有用リンク（予約ページ）
                    </p>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded truncate">{bookingUrl}</code>
                        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => copy(bookingUrl, "booking")}>
                            {copiedBooking ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedBooking ? "コピー済" : "コピー"}
                        </Button>
                    </div>
                </div>

                <div className="rounded-lg border bg-card/30 p-4 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                        <ExternalLink className="h-4 w-4" /> 管理用リンク（予約一覧）
                    </p>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded truncate">{adminUrl}</code>
                        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => copy(adminUrl, "admin")}>
                            {copiedAdmin ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedAdmin ? "コピー済" : "コピー"}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline" className="gap-2">
                    <Link href={`/office-hours/${id}`}>
                        <ExternalLink className="h-4 w-4" /> 予約ページを開く
                    </Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                    <Link href={`/office-hours/${id}/admin`}>
                        <CalendarIcon className="h-4 w-4" /> 予約一覧を開く
                    </Link>
                </Button>
                <Button asChild variant="ghost" className="gap-2">
                    <Link href="/office-hours">
                        Office Hour 一覧へ
                    </Link>
                </Button>
            </div>
        </div>
    );
}
