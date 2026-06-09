"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, Lock, AlertCircle, Calendar, Link2, Check, Trash2, Plus, X, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateLabel, formatTime, WEEKDAYS_JP } from "@/lib/officeHour";

type Booking = {
    id: string;
    officeHourId: string;
    slotStart: number;
    name: string;
    comment: string | null;
    email: string | null;
    userId: string | null;
    createdAt: number;
};

type TimeRange = { start: string; end: string };
type DayConfig = { enabled: boolean; ranges: TimeRange[] };
type WeeklyWindow = { day: number; start: string; end: string };

const DEFAULT_RANGE: TimeRange = { start: "13:00", end: "17:00" };

function windowsToDays(windows: WeeklyWindow[]): DayConfig[] {
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

function daysToWindows(days: DayConfig[]): WeeklyWindow[] {
    const windows: WeeklyWindow[] = [];
    for (let i = 0; i < days.length; i++) {
        if (!days[i].enabled) continue;
        for (const r of days[i].ranges) {
            windows.push({ day: i, start: r.start, end: r.end });
        }
    }
    return windows;
}

export function OfficeHourAdminView({ id }: { id: string }) {
    const [authorized, setAuthorized] = React.useState<boolean | null>(null);
    const [bookings, setBookings] = React.useState<Booking[]>([]);
    const [ohTitle, setOhTitle] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);

    const [password, setPassword] = React.useState("");
    const [authError, setAuthError] = React.useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    const [copied, setCopied] = React.useState(false);

    const [notFound, setNotFound] = React.useState(false);
    const [isDeleted, setIsDeleted] = React.useState(false);
    const [isDeleting, setIsDeleting] = React.useState(false);
    const [confirmDelete, setConfirmDelete] = React.useState(false);

    // 時間枠編集
    const [showSettings, setShowSettings] = React.useState(false);
    const [days, setDays] = React.useState<DayConfig[]>([]);
    const [isSavingWindows, setIsSavingWindows] = React.useState(false);
    const [windowsError, setWindowsError] = React.useState<string | null>(null);
    const [windowsSaved, setWindowsSaved] = React.useState(false);

    const load = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/office-hours/${id}/admin/bookings`);
            if (res.status === 404) {
                setNotFound(true);
                return;
            }
            if (res.status === 401) {
                setAuthorized(false);
                return;
            }
            if (!res.ok) {
                setAuthError("予約一覧の取得に失敗しました");
                return;
            }
            const data = (await res.json()) as { title: string; bookings: Booking[]; deleted?: boolean };
            setBookings(data.bookings);
            setOhTitle(data.title);
            if (data.deleted) setIsDeleted(true);
            setAuthorized(true);
        } catch (e) {
            console.error(e);
            setAuthError("通信エラーが発生しました");
        } finally {
            setIsLoading(false);
        }
    }, [id]);

    const loadSettings = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/office-hours/${id}/admin/settings`);
            if (!res.ok) return;
            const data = (await res.json()) as { windows: WeeklyWindow[] };
            setDays(windowsToDays(data.windows));
        } catch (e) {
            console.error(e);
        }
    }, [id]);

    React.useEffect(() => {
        load();
    }, [load]);

    React.useEffect(() => {
        if (authorized) loadSettings();
    }, [authorized, loadSettings]);

    const submitAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError(null);
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/office-hours/${id}/admin-auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                setAuthError("パスワードが正しくありません");
                return;
            }
            await load();
        } catch (err) {
            console.error(err);
            setAuthError("通信エラーが発生しました");
        } finally {
            setIsSubmitting(false);
        }
    };

    const grouped = React.useMemo(() => {
        const map = new Map<number, Booking[]>();
        for (const b of bookings) {
            const arr = map.get(b.slotStart) ?? [];
            arr.push(b);
            map.set(b.slotStart, arr);
        }
        return Array.from(map.entries())
            .sort(([a], [b]) => a - b)
            .map(([slotStart, list]) => ({ slotStart, bookings: list }));
    }, [bookings]);

    const downloadCsv = () => {
        const rows = [["枠開始", "枠日付", "枠時刻", "氏名", "メール", "コメント", "予約日時"]];
        for (const b of bookings) {
            const created = new Date(b.createdAt).toISOString();
            rows.push([
                String(b.slotStart),
                formatDateLabel(b.slotStart),
                formatTime(b.slotStart),
                b.name,
                b.email ?? "",
                (b.comment ?? "").replace(/"/g, '""'),
                created,
            ]);
        }
        const csv = "﻿" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `office-hour-${id}-bookings.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const copyBookingUrl = () => {
        if (typeof window === "undefined") return;
        const url = `${window.location.origin}/office-hours/${id}`;
        navigator.clipboard?.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/office-hours/${id}`, { method: "DELETE" });
            if (res.ok) {
                setIsDeleted(true);
                setConfirmDelete(false);
            } else {
                const data = await res.json().catch(() => ({})) as { error?: string };
                setAuthError(data.error ?? "削除に失敗しました");
            }
        } catch {
            setAuthError("通信エラーが発生しました");
        } finally {
            setIsDeleting(false);
        }
    };

    // 時間枠編集ヘルパー
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

    const saveWindows = async () => {
        const windows = daysToWindows(days);
        if (windows.length === 0) {
            setWindowsError("少なくとも1つ以上の曜日と時間帯を設定してください");
            return;
        }
        for (const w of windows) {
            const [sh, sm] = w.start.split(":").map(Number);
            const [eh, em] = w.end.split(":").map(Number);
            if (eh * 60 + em <= sh * 60 + sm) {
                setWindowsError(`${WEEKDAYS_JP[w.day]}曜日の時間帯が不正です（開始 < 終了 にしてください）`);
                return;
            }
        }

        setIsSavingWindows(true);
        setWindowsError(null);
        try {
            const res = await fetch(`/api/office-hours/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ windows }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                setWindowsError(data.error ?? "保存に失敗しました");
                return;
            }
            setWindowsSaved(true);
            setTimeout(() => setWindowsSaved(false), 2000);
        } catch {
            setWindowsError("通信エラーが発生しました");
        } finally {
            setIsSavingWindows(false);
        }
    };

    if (notFound) {
        return (
            <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
                <p className="text-muted-foreground">この Office Hour は存在しません</p>
            </div>
        );
    }

    if (isDeleted && !authorized) {
        return (
            <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
                <p className="font-semibold">この Office Hour は削除されました</p>
                <Button asChild variant="outline">
                    <Link href="/">トップページへ戻る</Link>
                </Button>
            </div>
        );
    }

    if (authorized === null && isLoading) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> 読み込み中...
            </div>
        );
    }

    if (authorized === false) {
        return (
            <form onSubmit={submitAuth} className="max-w-md mx-auto py-12 px-4 space-y-4">
                <div className="space-y-1.5">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Lock className="h-5 w-5" aria-hidden="true" /> 管理画面
                    </h1>
                    <p className="text-sm text-muted-foreground">パスワードを入力してください。</p>
                </div>
                <div className="space-y-1.5">
                    <label htmlFor="oh-admin-pw" className="text-sm font-medium">パスワード</label>
                    <Input id="oh-admin-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {authError && (
                    <div role="alert" className="text-sm text-destructive flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {authError}
                    </div>
                )}
                <Button type="submit" disabled={isSubmitting || !password} className="w-full sm:w-auto">
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    ログイン
                </Button>
            </form>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10 space-y-6">
            <div className="space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{ohTitle ? `${ohTitle} : 予約一覧` : "予約一覧"}</h1>
                <p className="text-sm text-muted-foreground">
                    全 {bookings.length} 件の予約 ({grouped.length} 枠)
                </p>
            </div>

            {isDeleted && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center space-y-3">
                    <p className="font-semibold text-destructive">この Office Hour は削除されました</p>
                    <p className="text-sm text-muted-foreground">予約ページからのアクセスは無効化されています。</p>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/">トップページへ戻る</Link>
                    </Button>
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyBookingUrl} className="gap-2" disabled={isDeleted}>
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Link2 className="h-4 w-4" />}
                    {copied ? "コピーしました" : "予約ページのURLをコピー"}
                </Button>
                <Button variant="outline" size="sm" onClick={downloadCsv} disabled={bookings.length === 0} className="gap-2">
                    <Download className="h-4 w-4" /> CSVダウンロード
                </Button>
                {/*
                {!isDeleted && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowSettings((p) => !p)}
                        className="gap-2"
                    >
                        <Settings className="h-4 w-4" />
                        時間枠を編集
                        {showSettings ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                )}
                */}
                {!isDeleted && !confirmDelete && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto">
                        <Trash2 className="h-4 w-4" /> 削除
                    </Button>
                )}
                {confirmDelete && (
                    <div className="flex items-center gap-2 ml-auto rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5">
                        <span className="text-sm text-destructive">本当に削除しますか？</span>
                        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting} className="gap-1.5">
                            {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            削除する
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={isDeleting}>
                            キャンセル
                        </Button>
                    </div>
                )}
            </div>

            {/* 時間枠編集パネル */}
            {showSettings && days.length > 0 && (
                <div className="rounded-lg border bg-card/30 p-4 space-y-3">
                    <h2 className="font-semibold flex items-center gap-2">
                        <Settings className="h-4 w-4" /> 受付時間帯（曜日別）
                    </h2>
                    <p className="text-xs text-muted-foreground">曜日を ON/OFF にして、時間帯を指定してください。変更後は「保存」を押してください。</p>
                    <div className="space-y-2">
                        {days.map((d, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "rounded-md border px-3 py-2 transition-colors",
                                    d.enabled ? "bg-card/40" : "bg-card/10 opacity-70"
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-2 min-w-[64px] cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={d.enabled}
                                            onChange={(e) => updateDay(i, { enabled: e.target.checked })}
                                            className="h-4 w-4 accent-primary"
                                        />
                                        <span className="font-medium">{WEEKDAYS_JP[i]}</span>
                                    </label>
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
                                                />
                                                {r.end === "24:00" && (
                                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">= 24:00</span>
                                                )}
                                                {d.ranges.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeRange(i, ri)}
                                                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
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
                    {windowsError && (
                        <div role="alert" className="text-sm text-destructive flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {windowsError}
                        </div>
                    )}
                    <div className="flex items-center gap-3">
                        <Button onClick={saveWindows} disabled={isSavingWindows} size="sm" className="gap-1.5">
                            {isSavingWindows && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            保存
                        </Button>
                        {windowsSaved && (
                            <span className="text-sm text-green-500 flex items-center gap-1">
                                <Check className="h-4 w-4" /> 保存しました
                            </span>
                        )}
                    </div>
                </div>
            )}

            {grouped.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <Calendar className="h-8 w-8 text-muted-foreground/60 mx-auto" aria-hidden="true" />
                    <p className="mt-3 font-medium">まだ予約はありません</p>
                    <p className="mt-1 text-sm text-muted-foreground">予約ページのURLを共有してください。</p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {grouped.map(({ slotStart, bookings: list }) => (
                        <li key={slotStart} className="rounded-md border bg-card/30 p-4">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="font-semibold">
                                    {formatDateLabel(slotStart)} {formatTime(slotStart)}
                                </div>
                                <span className="text-xs text-muted-foreground">{list.length}名</span>
                            </div>
                            <ul className="space-y-1.5">
                                {list.map((b) => (
                                    <li key={b.id} className="text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                        <span className="font-medium">{b.name}</span>
                                        {b.email && <span className="text-muted-foreground">{b.email}</span>}
                                        {b.comment && <span className="text-muted-foreground">— {b.comment}</span>}
                                    </li>
                                ))}
                            </ul>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
