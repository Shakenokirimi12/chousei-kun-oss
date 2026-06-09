"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, CheckCircle2, Lock, Users, Calendar, Sparkles, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/useUser";
import {
    formatDateLabel,
    formatIsoDate,
    formatTime,
    jstDayStartMs,
    type OfficeHourPublic,
} from "@/lib/officeHour";

const BOOKING_STORAGE_PREFIX = "chosei_oh_booking_";
const DAYS_PER_WEEK = 7;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;

type Slot = OfficeHourPublic["slots"][number];

function relMinFromHour(ms: number, startHour: number): number {
    const jst = new Date(ms + 9 * 60 * 60_000);
    return jst.getUTCHours() * 60 + jst.getUTCMinutes() - startHour * 60;
}

function minToPct(min: number, totalHours: number): number {
    return (min / (totalHours * 60)) * 100;
}

export function OfficeHourBookingView({ id }: { id: string }) {
    const { userId } = useUser();
    const [data, setData] = React.useState<OfficeHourPublic | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState<string | null>(null);

    const [weekOffset, setWeekOffset] = React.useState(0);
    const [bookedSlotStart, setBookedSlotStart] = React.useState<number | null>(null);

    // 予約モーダル
    const [pendingSlot, setPendingSlot] = React.useState<Slot | null>(null);
    const [name, setName] = React.useState("");
    const [comment, setComment] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [isBooking, setIsBooking] = React.useState(false);
    const [bookingError, setBookingError] = React.useState<string | null>(null);
    const [bookingSuccess, setBookingSuccess] = React.useState(false);

    React.useEffect(() => {
        const stored = localStorage.getItem(`${BOOKING_STORAGE_PREFIX}${id}`);
        if (stored) {
            const parsed = Number(stored);
            if (!Number.isNaN(parsed)) setBookedSlotStart(parsed);
        }
    }, [id]);

    const load = React.useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const res = await fetch(`/api/office-hours/${id}`);
            if (!res.ok) {
                if (res.status === 410) {
                    setLoadError("deleted");
                } else if (res.status === 404) {
                    setLoadError("この Office Hour は存在しません");
                } else {
                    setLoadError("読み込みに失敗しました");
                }
                return;
            }
            setData((await res.json()) as OfficeHourPublic);
        } catch (e) {
            console.error(e);
            setLoadError("通信エラーが発生しました");
        } finally {
            setIsLoading(false);
        }
    }, [id]);

    React.useEffect(() => { load(); }, [load]);

    // 今週の基準日
    const todayMs = React.useMemo(() => {
        const now = new Date();
        const jst = new Date(now.getTime() + 9 * 60 * 60_000);
        return jstDayStartMs(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
    }, []);

    const weekStartMs = todayMs + weekOffset * DAYS_PER_WEEK * 24 * 60 * 60_000;
    const weekEndMs = weekStartMs + DAYS_PER_WEEK * 24 * 60 * 60_000;

    // 日別ヘッダー
    const days = React.useMemo(() => {
        return Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
            const dayMs = weekStartMs + i * 24 * 60 * 60_000;
            return {
                iso: formatIsoDate(dayMs),
                label: formatDateLabel(dayMs),
                dayMs,
            };
        });
    }, [weekStartMs]);

    // この週のスロットを日別にグルーピング
    const slotsByDay = React.useMemo(() => {
        if (!data) return new Map<string, Slot[]>();
        const map = new Map<string, Slot[]>();
        for (const slot of data.slots) {
            if (slot.startMs < weekStartMs || slot.startMs >= weekEndMs) continue;
            const iso = formatIsoDate(slot.startMs);
            const arr = map.get(iso) ?? [];
            arr.push(slot);
            map.set(iso, arr);
        }
        return map;
    }, [data, weekStartMs, weekEndMs]);

    // 全期間にスロットがある週の範囲
    const { minWeekOffset, maxWeekOffset } = React.useMemo(() => {
        if (!data || data.slots.length === 0) return { minWeekOffset: 0, maxWeekOffset: 0 };
        const first = data.slots[0].startMs;
        const last = data.slots[data.slots.length - 1].startMs;
        const minOff = Math.floor((first - todayMs) / (DAYS_PER_WEEK * 24 * 60 * 60_000));
        const maxOff = Math.floor((last - todayMs) / (DAYS_PER_WEEK * 24 * 60 * 60_000));
        return { minWeekOffset: minOff, maxWeekOffset: maxOff };
    }, [data, todayMs]);

    const { timelineStartHour, timelineHours } = React.useMemo(() => {
        if (!data) return { timelineStartHour: DEFAULT_START_HOUR, timelineHours: DEFAULT_END_HOUR - DEFAULT_START_HOUR };
        let minH = 24;
        let maxH = 0;
        for (const slot of data.slots) {
            if (slot.startMs < weekStartMs || slot.startMs >= weekEndMs) continue;
            const sJst = new Date(slot.startMs + 9 * 60 * 60_000);
            const eJst = new Date(slot.endMs + 9 * 60 * 60_000);
            const sh = sJst.getUTCHours();
            const eh = eJst.getUTCMinutes() > 0 ? eJst.getUTCHours() + 1 : eJst.getUTCHours();
            if (sh < minH) minH = sh;
            if (eh > maxH) maxH = eh;
        }
        if (minH >= maxH) { minH = DEFAULT_START_HOUR; maxH = DEFAULT_END_HOUR; }
        if (maxH - minH < 2) maxH = minH + 2;
        return { timelineStartHour: minH, timelineHours: maxH - minH };
    }, [data, weekStartMs, weekEndMs]);

    const weekLabel = React.useMemo(() => {
        const s = formatDateLabel(weekStartMs);
        const e = formatDateLabel(weekStartMs + 6 * 24 * 60 * 60_000);
        return `${s} 〜 ${e}`;
    }, [weekStartMs]);

    const openBookingModal = (slot: Slot) => {
        setPendingSlot(slot);
        setBookingError(null);
        setBookingSuccess(false);
    };

    const closeModal = () => {
        if (isBooking) return;
        setPendingSlot(null);
        setName("");
        setComment("");
        setEmail("");
        setBookingError(null);
        setBookingSuccess(false);
    };

    const submitBooking = async () => {
        if (!pendingSlot || !data) return;
        const trimmedName = name.trim();
        if (!trimmedName) {
            setBookingError("お名前を入力してください");
            return;
        }
        const trimmedEmail = email.trim();
        if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setBookingError("メールアドレスの形式が正しくありません");
            return;
        }

        setIsBooking(true);
        setBookingError(null);
        try {
            const res = await fetch(`/api/office-hours/${id}/book`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slotStart: pendingSlot.startMs,
                    name: trimmedName,
                    comment: comment.trim() || undefined,
                    email: trimmedEmail || undefined,
                    userId: userId ?? undefined,
                }),
            });
            if (!res.ok) {
                const err = (await res.json().catch(() => ({}))) as { error?: string };
                setBookingError(err.error ?? "予約に失敗しました");
                if (res.status === 409) await load();
                return;
            }
            localStorage.setItem(`${BOOKING_STORAGE_PREFIX}${id}`, String(pendingSlot.startMs));
            setBookedSlotStart(pendingSlot.startMs);
            setBookingSuccess(true);
            await load();
        } catch (e) {
            console.error(e);
            setBookingError("通信エラーが発生しました");
        } finally {
            setIsBooking(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> 読み込み中...
            </div>
        );
    }

    if (loadError === "deleted") {
        return (
            <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
                <p className="font-semibold">この Office Hour は削除されました</p>
                <p className="text-sm text-muted-foreground">主催者により削除されたため、予約の受付は終了しています。</p>
                <Button asChild variant="outline">
                    <Link href="/">トップページへ戻る</Link>
                </Button>
            </div>
        );
    }

    if (loadError || !data) {
        return (
            <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
                <p className="text-muted-foreground">{loadError ?? "読み込みに失敗しました"}</p>
            </div>
        );
    }

    const { officeHour } = data;
    const lastSyncLabel =
        officeHour.lastSyncAt !== null
            ? new Date(officeHour.lastSyncAt).toLocaleString("ja-JP", { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" })
            : "未同期";

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">
            {/* ヘッダー */}
            <div className="space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight break-words">{officeHour.title}</h1>
                {officeHour.description && (
                    <p className="text-sm sm:text-base text-muted-foreground break-words">{officeHour.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
                    <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        {officeHour.slotDurationMin}分枠 / 定員{officeHour.capacityPerSlot}名
                    </span>
                    <span className="flex items-center gap-1">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        最終同期: {lastSyncLabel}
                    </span>
                </div>
            </div>

            {/* 自分の予約 */}
            {bookedSlotStart !== null && (
                <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-4 flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="text-sm">
                        <p className="font-medium">予約済み</p>
                        <p className="text-muted-foreground mt-0.5">
                            {formatDateLabel(bookedSlotStart)} {formatTime(bookedSlotStart)}〜
                        </p>
                    </div>
                </div>
            )}

            {/* 凡例 + 週切替 */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setWeekOffset((p) => p - 1)}
                        disabled={weekOffset <= minWeekOffset}
                        className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="前の週"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs text-muted-foreground min-w-[160px] text-center">
                        {weekOffset === 0 ? "今週" : weekLabel}
                    </span>
                    <button
                        type="button"
                        onClick={() => setWeekOffset((p) => p + 1)}
                        disabled={weekOffset >= maxWeekOffset}
                        className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="次の週"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    {weekOffset !== 0 && (
                        <button
                            type="button"
                            onClick={() => setWeekOffset(0)}
                            className="text-[10px] text-primary hover:text-primary/80 ml-1"
                        >
                            今週に戻る
                        </button>
                    )}
                </div>
                <div className="flex gap-2.5 text-[11px] text-muted-foreground ml-auto">
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/30 border border-emerald-500/50" /> 予約可
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted/50 border border-muted-foreground/30" /> 予約不可
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500/30 border border-green-500/50" /> 予約済み
                    </span>
                </div>
            </div>

            {/* カレンダー本体 */}
            {data.slots.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                    現在予約可能な枠はありません。
                </div>
            ) : (
                <div className="rounded-md border bg-card/20 flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: "600px" }}>
                    {/* 日付ヘッダー */}
                    <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))] border-b bg-muted/20 shrink-0">
                        <div />
                        {days.map((d) => {
                            const daySlots = slotsByDay.get(d.iso) ?? [];
                            const openCount = daySlots.filter((s) => !s.blocked && s.remaining > 0).length;
                            return (
                                <div key={d.iso} className="text-center py-1.5 border-l">
                                    <div className="text-xs font-medium">{d.label}</div>
                                    {daySlots.length > 0 && (
                                        <div className={cn("text-[10px]", openCount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                                            空き{openCount}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* タイムライン */}
                    <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))] flex-1 min-h-0 relative">
                        {/* 時間軸 */}
                        <div className="relative border-r">
                            {Array.from({ length: timelineHours + 1 }).map((_, i) => {
                                const h = timelineStartHour + i;
                                const pct = (i / timelineHours) * 100;
                                return (
                                    <div
                                        key={h}
                                        className="absolute right-1 text-[10px] text-muted-foreground -translate-y-1/2"
                                        style={{ top: `${pct}%` }}
                                    >
                                        {h}:00
                                    </div>
                                );
                            })}
                        </div>

                        {/* 各日カラム */}
                        {days.map((d) => {
                            const daySlots = slotsByDay.get(d.iso) ?? [];
                            return (
                                <div key={d.iso} className="relative border-l">
                                    {/* グリッド線 */}
                                    {Array.from({ length: timelineHours + 1 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="absolute w-full border-t border-border/30"
                                            style={{ top: `${(i / timelineHours) * 100}%` }}
                                        />
                                    ))}
                                    {/* スロットブロック */}
                                    {daySlots.map((slot) => {
                                        const startPct = minToPct(relMinFromHour(slot.startMs, timelineStartHour), timelineHours);
                                        const endPct = minToPct(relMinFromHour(slot.endMs, timelineStartHour), timelineHours);
                                        const topPct = Math.max(0, startPct);
                                        const bottomPct = Math.min(100, endPct);
                                        if (bottomPct <= 0 || topPct >= 100) return null;

                                        const isMine = bookedSlotStart === slot.startMs;
                                        const available = !slot.blocked && slot.remaining > 0 && !isMine;

                                        let blockClass: string;
                                        let icon: React.ReactNode = null;
                                        if (isMine) {
                                            blockClass = "bg-green-500/20 border-green-500/60 hover:bg-green-500/30";
                                            icon = <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />;
                                        } else if (slot.blocked) {
                                            blockClass = "bg-muted/30 border-muted-foreground/20 text-muted-foreground";
                                            icon = <Lock className="h-3 w-3 shrink-0" />;
                                        } else if (slot.remaining <= 0) {
                                            blockClass = "bg-muted/30 border-muted-foreground/20 text-muted-foreground";
                                            icon = <Users className="h-3 w-3 shrink-0" />;
                                        } else {
                                            blockClass = "bg-emerald-500/15 border-emerald-500/50 hover:bg-emerald-500/30 cursor-pointer";
                                        }

                                        const heightPct = Math.max(2, bottomPct - topPct);

                                        return (
                                            <button
                                                key={slot.startMs}
                                                type="button"
                                                onClick={() => available && openBookingModal(slot)}
                                                disabled={!available}
                                                className={cn(
                                                    "absolute inset-x-0.5 rounded-sm border text-[10px] px-1 py-0.5 overflow-hidden transition-colors",
                                                    "flex flex-col items-center justify-center gap-0.5",
                                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                    blockClass,
                                                    !available && "cursor-default"
                                                )}
                                                style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                                                aria-label={`${formatTime(slot.startMs)}〜${formatTime(slot.endMs)} ${isMine ? "予約済み" : slot.blocked ? "予約不可" : slot.remaining <= 0 ? "満員" : `残り${slot.remaining}`}`}
                                            >
                                                <span className="font-semibold leading-none truncate">
                                                    {formatTime(slot.startMs)}
                                                </span>
                                                {heightPct > 5 && (
                                                    <span className="flex items-center gap-0.5 leading-none opacity-80">
                                                        {icon}
                                                        {isMine ? "予約済" : slot.blocked ? "" : slot.remaining <= 0 ? "満員" : `残${slot.remaining}`}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 予約モーダル */}
            <Dialog open={pendingSlot !== null} onOpenChange={(open) => { if (!open) closeModal(); }}>
                <DialogContent className="sm:max-w-md">
                    {bookingSuccess ? (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true" />
                                    予約が完了しました
                                </DialogTitle>
                                <DialogDescription>
                                    {pendingSlot && (
                                        <>
                                            {formatDateLabel(pendingSlot.startMs)} {formatTime(pendingSlot.startMs)}〜{formatTime(pendingSlot.endMs)}
                                        </>
                                    )}
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button onClick={closeModal}>閉じる</Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            <DialogHeader>
                                <DialogTitle>この枠を予約しますか？</DialogTitle>
                                <DialogDescription>
                                    {pendingSlot && (
                                        <>
                                            {formatDateLabel(pendingSlot.startMs)} {formatTime(pendingSlot.startMs)}〜{formatTime(pendingSlot.endMs)}
                                        </>
                                    )}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-3 py-2">
                                <div className="space-y-1.5">
                                    <label htmlFor="oh-name" className="text-sm font-medium">お名前 <span className="text-destructive">*</span></label>
                                    <Input id="oh-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
                                </div>
                                <div className="space-y-1.5">
                                    <label htmlFor="oh-email" className="text-sm font-medium">メールアドレス（任意）</label>
                                    <Input id="oh-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
                                </div>
                                <div className="space-y-1.5">
                                    <label htmlFor="oh-comment" className="text-sm font-medium">コメント（任意）</label>
                                    <Input id="oh-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
                                </div>
                                {bookingError && (
                                    <div role="alert" className="text-sm text-destructive flex items-start gap-2">
                                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {bookingError}
                                    </div>
                                )}
                            </div>
                            <DialogFooter className="gap-2 sm:gap-2">
                                <Button variant="ghost" onClick={closeModal} disabled={isBooking}>キャンセル</Button>
                                <Button onClick={submitBooking} disabled={isBooking || !name.trim()}>
                                    {isBooking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    予約する
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
