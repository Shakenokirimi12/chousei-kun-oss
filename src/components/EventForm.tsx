"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { PeriodSelector, CUSTOM_PERIODS, HOURLY_SLOTS } from "@/components/PeriodSelector";
import { AllDayRangeSelector } from "@/components/AllDayRangeSelector";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isAllDayEvent, allDayEventDateRange } from "@/lib/candidates";
import { Loader2, Check, Copy, ExternalLink, ArrowRight, X as XIcon } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";
import { useCopy } from "@/hooks/useCopy";
import QRCode from "react-qr-code";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import dynamic from 'next/dynamic';

const CalendarImportMenu = dynamic(() => import('@/components/CalendarImportMenu'), { ssr: false });

/** カレンダー取り込み元の予定（iCal / Google など由来でフィールド名が揺れるため両対応） */
type CalendarBusyEvent = {
    dtstart?: string | Date;
    dtend?: string | Date;
    start?: string | Date;
    end?: string | Date;
};

const JST_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" });

// iCal and Campus Square send all-day dates as JST midnight in UTC ISO form
// ("...T15:00:00.000Z" of the previous day). allDayEventDateRange reads the leading
// "YYYY-MM-DD" as is, so read the date in JST, independent of the browser timezone.
function toAllDayDateStr(raw: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? "" : JST_DATE_FORMAT.format(d);
}

// A malformed feed can carry an all-day event spanning years. Cap the span so expanding
// it into per-day blocks stays cheap.
const MAX_ALL_DAY_SPAN_DAYS = 366;

// All-day events listed up front when importing: the same span as the Google Calendar
// fetch in src/server/api/routes/google.ts.
const ALL_DAY_CHOICE_WINDOW_MS = 1000 * 60 * 60 * 24 * 120;

type ImportedBusyEvent = { start: string; end: string; summary: string; allDay: boolean };

function isSameBusyEvent(a: ImportedBusyEvent, b: ImportedBusyEvent): boolean {
    return a.allDay === b.allDay && a.start === b.start && a.end === b.end && a.summary === b.summary;
}

/** Normalizes an all-day event to JST "YYYY-MM-DD" dates with an exclusive, capped end. */
function normalizeAllDayEvent(ev: ImportedBusyEvent): ImportedBusyEvent | null {
    const start = toAllDayDateStr(ev.start);
    if (!start) return null;
    const startDay = new Date(`${start}T00:00:00`);
    const minEnd = new Date(startDay);
    minEnd.setDate(minEnd.getDate() + 1);
    const maxEnd = new Date(startDay);
    maxEnd.setDate(maxEnd.getDate() + MAX_ALL_DAY_SPAN_DAYS);
    let end = toAllDayDateStr(ev.end);
    if (!end || end <= start) end = format(minEnd, "yyyy-MM-dd");
    if (end > format(maxEnd, "yyyy-MM-dd")) end = format(maxEnd, "yyyy-MM-dd");
    return { ...ev, start, end };
}

/** "11/3(火)" or "11/3(火)〜11/5(木)" for a normalized all-day event (end is exclusive). */
function formatAllDayRange(ev: ImportedBusyEvent): string {
    const start = new Date(`${ev.start}T00:00:00`);
    const last = new Date(`${ev.end}T00:00:00`);
    last.setDate(last.getDate() - 1);
    const startLabel = format(start, "M/d(E)", { locale: ja });
    return last > start ? `${startLabel}〜${format(last, "M/d(E)", { locale: ja })}` : startLabel;
}

/**
 * 共有用 URL のカード。コピー結果をボタン上でインライン表示する。
 * 成功 → Check + "コピーしました"、失敗 → X + "コピーできませんでした"。
 */
function UrlShareCard({
    step,
    color,
    title,
    url,
    hint,
}: {
    step: number;
    color: "primary" | "orange";
    title: string;
    url: string;
    hint: string;
}) {
    const { copied, error, copy } = useCopy();
    const [qrOpen, setQrOpen] = React.useState(false);
    const accent =
        color === "primary"
            ? "text-primary"
            : "text-orange-500";
    const badgeBg =
        color === "primary"
            ? "bg-primary text-primary-foreground"
            : "bg-orange-500 text-white";
    return (
        <div className="p-4 rounded-xl border bg-background/50 space-y-3">
            <h4 className={cn("font-bold flex items-center gap-2", accent)}>
                <span className={cn("flex items-center justify-center w-6 h-6 rounded-full text-xs", badgeBg)}>{step}</span>
                {title}
            </h4>
            <div className="flex gap-2">
                <Input value={url} readOnly className="bg-muted/50" />
                <Button
                    size="sm"
                    variant={copied ? "default" : "outline"}
                    onClick={() => copy(url)}
                    aria-label="URLをコピー"
                    aria-live="polite"
                    className={cn(
                        "gap-2 min-w-[120px] transition-colors",
                        copied && "bg-emerald-600 hover:bg-emerald-600 text-white",
                        error && "border-red-500 text-red-600",
                    )}
                >
                    {copied ? (
                        <>
                            <Check className="h-4 w-4" />
                            コピー済み
                        </>
                    ) : error ? (
                        <>
                            <XIcon className="h-4 w-4" />
                            失敗
                        </>
                    ) : (
                        <>
                            <Copy className="h-4 w-4" />
                            コピー
                        </>
                    )}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setQrOpen((v) => !v)}
                    aria-label="QRコードを表示"
                    aria-expanded={qrOpen}
                >
                    QR
                </Button>
            </div>
            {qrOpen && (
                <div className="flex justify-center p-3 rounded-lg bg-white">
                    <QRCode value={url} size={176} style={{ height: "auto", maxWidth: "100%", width: "176px" }} />
                </div>
            )}
            <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
    );
}

export function EventForm() {
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [adminPassword, setAdminPassword] = React.useState("");
    const [selectedPeriods, setSelectedPeriods] = React.useState<string[]>([]);
    const [showRestoreDialog, setShowRestoreDialog] = React.useState(false);
    const [draftSavedAt, setDraftSavedAt] = React.useState<number | null>(null);
    // "timed": 時間帯で調整（既存） / "allday": 日毎の出欠確認（終日候補）
    const [selectionMode, setSelectionMode] = React.useState<"timed" | "allday">("timed");
    const [pendingMode, setPendingMode] = React.useState<"timed" | "allday" | null>(null);
    const DRAFT_KEY = "chouseikun_draft_periods";
    const DRAFT_SAVED_AT_KEY = "chouseikun_draft_saved_at";

    React.useEffect(() => {
        const savedDraft = localStorage.getItem(DRAFT_KEY);
        if (savedDraft) {
            try {
                const parsed = JSON.parse(savedDraft);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setShowRestoreDialog(true);
                    const savedAt = Number(localStorage.getItem(DRAFT_SAVED_AT_KEY));
                    setDraftSavedAt(Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null);
                }
            } catch (e) {
                console.error("Failed to parse draft", e);
            }
        }
    }, []);

    React.useEffect(() => {
        if (selectedPeriods.length > 0) {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(selectedPeriods));
            localStorage.setItem(DRAFT_SAVED_AT_KEY, String(Date.now()));
        }
    }, [selectedPeriods]);

    React.useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (selectedPeriods.length > 0 || title.length > 0) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [selectedPeriods, title]);

    // Holds timed events plus only the all-day events the organizer chose to reflect.
    const [universityBusyEvents, setUniversityBusyEvents] = React.useState<ImportedBusyEvent[]>([]);
    // All-day entries are often holidays, birthdays, or reminders that do not block a
    // meeting, so the organizer picks which ones to reflect when importing.
    const [allDayChoice, setAllDayChoice] = React.useState<{
        events: ImportedBusyEvent[];
        selected: boolean[];
        timedCount: number;
        /** Events are sorted by date; the first nearCount fall within ALL_DAY_CHOICE_WINDOW_MS. */
        nearCount: number;
        showAll: boolean;
    } | null>(null);
    // Mirrors universityBusyEvents synchronously so an import can tell how many events
    // were actually new before React applies the state update.
    const busyEventsRef = React.useRef<ImportedBusyEvent[]>([]);

    const visibleBusyEvents = React.useMemo(() => {
        return universityBusyEvents.flatMap((ev) => {
            if (!ev.allDay) return [ev];
            // Expand to local midnight-to-midnight blocks so every covered day is marked in full.
            return allDayEventDateRange(ev.start, ev.end).map((dateStr) => {
                const start = new Date(`${dateStr}T00:00:00`);
                const end = new Date(start);
                end.setDate(end.getDate() + 1);
                return { ...ev, start: start.toISOString(), end: end.toISOString() };
            });
        });
    }, [universityBusyEvents]);

    const mapEventsToPeriods = React.useCallback((events: CalendarBusyEvent[]) => {
        const newBusyPeriods: string[] = [];

        events.forEach(event => {
            const startDate = new Date(event.dtstart || event.start || "");
            const endDate = new Date(event.dtend || event.end || "");
            // Local date: the slots below are built with local setHours, and a UTC date
            // would shift events before 9:00 JST onto the previous day.
            const dateStr = format(startDate, "yyyy-MM-dd");

            const checkOverlap = (startA: Date, endA: Date, startB: Date, endB: Date) => {
                return startA < endB && endA > startB;
            }

            CUSTOM_PERIODS.forEach((p) => {
                const [startH, startM] = p.time.split("-")[0].split(":").map(Number);
                const [endH, endM] = p.time.split("-")[1].split(":").map(Number);

                const pStart = new Date(startDate);
                pStart.setHours(startH, startM, 0, 0);
                const pEnd = new Date(startDate);
                pEnd.setHours(endH, endM, 0, 0);

                if (checkOverlap(startDate, endDate, pStart, pEnd)) {
                    newBusyPeriods.push(`${dateStr}_P${p.id}`);
                }
            });

            HOURLY_SLOTS.forEach(h => {
                const [startH] = h.time.split("-")[0].split(":").map(Number);
                const pStart = new Date(startDate);
                pStart.setHours(startH, 0, 0, 0);
                const pEnd = new Date(startDate);
                pEnd.setHours(startH + 1, 0, 0, 0);

                if (checkOverlap(startDate, endDate, pStart, pEnd)) {
                    newBusyPeriods.push(`${dateStr}_H${h.id}`);
                }
            });
        });
        return [...new Set(newBusyPeriods)];
    }, []);

    const busyPeriodIds = React.useMemo(() => {
        return mapEventsToPeriods(visibleBusyEvents);
    }, [visibleBusyEvents, mapEventsToPeriods]);

    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const ENABLE_CAMPUS_SQUARE = process.env.NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE === 'true';

    const [feedback, setFeedback] = React.useState<{ title: string; message: string; isOpen: boolean }>({
        title: "",
        message: "",
        isOpen: false,
    });

    const closeFeedback = () => setFeedback(prev => ({ ...prev, isOpen: false }));

    /** Adds events not reflected yet and returns how many were new. */
    const mergeBusyEvents = React.useCallback((newEvents: ImportedBusyEvent[]) => {
        const added: ImportedBusyEvent[] = [];
        newEvents.forEach(ne => {
            if (![...busyEventsRef.current, ...added].some(p => isSameBusyEvent(p, ne))) added.push(ne);
        });
        if (added.length > 0) {
            busyEventsRef.current = [...busyEventsRef.current, ...added];
            setUniversityBusyEvents(busyEventsRef.current);
        }
        return added.length;
    }, []);

    const showImportResult = React.useCallback((timedCount: number, allDayCount: number) => {
        setFeedback({
            title: "インポート成功",
            message: timedCount + allDayCount === 0
                ? "反映する予定はありませんでした。"
                : [
                    `${timedCount + allDayCount}件の予定を反映しました。これらは赤色で表示されます。`,
                    allDayCount > 0 && `うち${allDayCount}件は終日の予定で、その日を一日中「予定あり」にしています。`,
                ].filter(Boolean).join(""),
            isOpen: true
        });
    }, []);

    const addImportedBusyEvents = React.useCallback(
        (events: { dtstart: string; dtend: string; summary?: string; allDay?: boolean }[]) => {
            const newEvents: ImportedBusyEvent[] = events.map(ev => ({
                start: ev.dtstart,
                end: ev.dtend,
                summary: ev.summary || "予定あり",
                allDay: !!ev.allDay,
            }));
            const timedAdded = mergeBusyEvents(newEvents.filter(ev => !ev.allDay));

            // Past days cannot be candidates, so only ask about all-day events still ahead
            // that are not reflected yet.
            const today = JST_DATE_FORMAT.format(new Date());
            const allDayEvents = newEvents
                .filter(ev => ev.allDay)
                .map(normalizeAllDayEvent)
                .filter((ev): ev is ImportedBusyEvent => ev !== null && ev.end > today)
                .filter((ev, i, arr) => arr.findIndex(other => isSameBusyEvent(other, ev)) === i)
                .filter(ev => !busyEventsRef.current.some(p => isSameBusyEvent(p, ev)))
                .sort((a, b) => a.start.localeCompare(b.start));

            if (allDayEvents.length === 0) {
                showImportResult(timedAdded, 0);
                return;
            }
            // Feeds such as holiday calendars span years. List the window the Google import
            // also covers first, and leave the rest behind a button.
            const horizon = JST_DATE_FORMAT.format(new Date(Date.now() + ALL_DAY_CHOICE_WINDOW_MS));
            const nearCount = allDayEvents.filter(ev => ev.start <= horizon).length;
            setAllDayChoice({
                events: allDayEvents,
                selected: allDayEvents.map(() => false),
                timedCount: timedAdded,
                nearCount,
                showAll: nearCount === 0,
            });
        },
        [mergeBusyEvents, showImportResult]
    );

    const finishAllDayChoice = (apply: boolean) => {
        if (!allDayChoice) return;
        const chosen = apply ? allDayChoice.events.filter((_, i) => allDayChoice.selected[i]) : [];
        const allDayAdded = mergeBusyEvents(chosen);
        setAllDayChoice(null);
        showImportResult(allDayChoice.timedCount, allDayAdded);
    };

    const handleCampusSquareImport = async (uid: string, pass: string) => {
        if (!ENABLE_CAMPUS_SQUARE) return;

        const res = await fetch("/api/sync-calendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid, pass }),
        });

        if (!res.ok) {
            const error = await res.json() as { error: string };
            throw new Error(error.error || "インポートに失敗しました");
        }

        const data = await res.json() as { events: { dtstart: string, dtend: string, summary: string, allDay?: boolean }[] };
        addImportedBusyEvents(data.events);
    }

    const handleICalImport = async (url: string) => {
        try {
            const res = await fetch("/api/sync-ical", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
            });

            if (!res.ok) {
                const error = await res.json() as { error: string };
                throw new Error(error.error || "インポートに失敗しました");
            }

            const data = await res.json() as { events: { dtstart: string, dtend: string, summary?: string, allDay?: boolean }[] };
            addImportedBusyEvents(data.events);
        } catch (error) {
            setFeedback({
                title: "エラー",
                message: error instanceof Error ? error.message : "インポートに失敗しました",
                isOpen: true
            });
        }
    }

    const [isGoogleImporting, setIsGoogleImporting] = React.useState(false);

    const handleGoogleImport = React.useCallback(async () => {
        setIsGoogleImporting(true);
        try {
            const res = await fetch("/api/google/calendar/events");
            if (res.status === 401) {
                const url = new URL(window.location.href);
                const returnTo = encodeURIComponent(url.pathname + url.search);
                // 自分の予定プレビューのみ使うため read スコープに留める
                window.location.href = `/api/google/auth/start?returnTo=${returnTo}&scope=read`;
                return;
            }
            if (!res.ok) {
                setFeedback({
                    title: "連携エラー",
                    message: "Googleカレンダーの取得に失敗しました。",
                    isOpen: true,
                });
                return;
            }
            const data = (await res.json()) as { events: { dtstart: string; dtend: string; summary?: string; allDay?: boolean }[] };
            addImportedBusyEvents(data.events);
        } catch (e) {
            console.error(e);
            setFeedback({
                title: "エラー",
                message: "Googleカレンダーのインポート中にエラーが発生しました。",
                isOpen: true,
            });
        } finally {
            setIsGoogleImporting(false);
        }
    }, [addImportedBusyEvents]);

    React.useEffect(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.get("googleOAuth") !== "1") return;

        handleGoogleImport().finally(() => {
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete(), not a DB query
            url.searchParams.delete("googleOAuth");
            window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        });
    }, [handleGoogleImport]);

    const [createdEventId, setCreatedEventId] = React.useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title || selectedPeriods.length === 0) return;

        setIsSubmitting(true);
        try {
            const sortedCandidates = [...selectedPeriods].sort((a, b) => {
                const [dateA, slotA] = a.split("_");
                const [dateB, slotB] = b.split("_");
                if (dateA !== dateB) return dateA.localeCompare(dateB);

                const getStartTime = (slot: string) => {
                    if (slot === "D") {
                        return "00:00";
                    } else if (slot.startsWith("P")) {
                        const id = parseInt(slot.substring(1));
                        const p = CUSTOM_PERIODS.find((x) => x.id === id);
                        return p ? p.time.split("-")[0] : "00:00";
                    } else if (slot.startsWith("H")) {
                        const id = parseInt(slot.substring(1));
                        return `${id.toString().padStart(2, '0')}:00`;
                    } else {
                        const id = parseInt(slot);
                        const p = CUSTOM_PERIODS.find((x) => x.id === id);
                        return p ? p.time.split("-")[0] : "00:00";
                    }
                }
                return getStartTime(slotA).localeCompare(getStartTime(slotB));
            });

            // 「自分が作ったイベント一覧」(/me) で再表示できるよう、
            // localStorage の userId を作成者として送る。
            // 作成画面は useUser を使わないので、まだ ID が無い端末ではここで発行する。
            // 発行しないと、初めての端末で作ったイベントがマイページに載らない。
            let creatorUserId: string | undefined;
            if (typeof window !== "undefined") {
                creatorUserId = localStorage.getItem("chosei_user_id") || undefined;
                // randomUUID は HTTPS / localhost でしか使えない。LAN の IP で開いた開発環境などでは
                // マイページへの掲載をあきらめ、作成そのものは止めない
                if (!creatorUserId && typeof crypto.randomUUID === "function") {
                    creatorUserId = crypto.randomUUID();
                    localStorage.setItem("chosei_user_id", creatorUserId);
                }
            }
            const response = await fetch("/api/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, description, candidates: sortedCandidates, adminPassword, creatorUserId }),
            });

            if (!response.ok) throw new Error("イベントの作成に失敗しました");

            const data = await response.json() as { id: string };
            setCreatedEventId(data.id);
            localStorage.removeItem(DRAFT_KEY);
            localStorage.removeItem(DRAFT_SAVED_AT_KEY);
            setIsModalOpen(false);
        } catch (error) {
            console.error(error);
            setFeedback({
                title: "エラー",
                message: "イベントの作成に失敗しました。もう一度お試しください。",
                isOpen: true
            });
        } finally {
            setIsSubmitting(false);
        }
    };


    if (createdEventId) {
        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        const participantUrl = `${baseUrl}/${createdEventId}`;
        const resultsUrl = `${baseUrl}/${createdEventId}/results`;
        const adminUrl = `${baseUrl}/${createdEventId}/admin`;

        // 旧実装はモーダル(setFeedback)でコピー成功を通知していたが画面を遮るため、
        // 各 URL ボタンに inline で状態を持たせるよう変更した（下記 UrlShareCard）。

        // PC の作成ページは h-dvh overflow-hidden（タイムライン編集用の1画面レイアウト）なので、
        // 完了画面はこの中で自前でスクロールさせる。させないと背の低い画面で管理用 URL が見切れる。
        return (
            <div className="w-full flex-1 min-h-0 overflow-y-auto animate-in fade-in zoom-in-95 duration-500">
                <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur-md shadow-2xl overflow-hidden">
                    <CardHeader className="text-center pb-2">
                        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                            <Check className="w-10 h-10 text-primary" />
                        </div>
                        <CardTitle className="text-3xl font-bold">イベントを作成しました！</CardTitle>
                        <CardDescription className="text-lg">以下のURLを共有・保存してください。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        <div className="space-y-4">
                            <UrlShareCard
                                step={1}
                                color="primary"
                                title="回答用 URL (参加者に共有)"
                                url={participantUrl}
                                hint="参加者が日程を回答するためのURLです。SNSやメールで共有してください。"
                            />
                            <UrlShareCard
                                step={2}
                                color="orange"
                                title="結果確認 URL (参加者向け)"
                                url={resultsUrl}
                                hint="回答状況を公開して確認するためのURLです。"
                            />
                            <UrlShareCard
                                step={3}
                                color="orange"
                                title="管理用 URL (あなた専用)"
                                url={adminUrl}
                                hint="回答状況を確認し、最終日程を決定するためのプライベートなURLです。"
                            />
                            <p className="text-sm text-muted-foreground">
                                作成したイベントは、この端末の
                                <Link href="/me" className="mx-1 underline underline-offset-4 hover:text-foreground">
                                    マイページ
                                </Link>
                                からも開けます。別の端末では表示されないので、管理用 URL は控えておいてください。
                            </p>
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3 pb-8">
                        <Link href={`/${createdEventId}`} className="w-full">
                            <Button className="w-full py-6 text-lg gap-2" size="lg">
                                回答画面へ移動 <ArrowRight className="h-5 w-5" />
                            </Button>
                        </Link>
                        <Link href={`/${createdEventId}/admin`} className="w-full">
                            <Button variant="ghost" className="w-full gap-2">
                                管理画面で設定を行う <ExternalLink className="h-4 w-4" />
                            </Button>
                        </Link>
                        <Link href="/" className="w-full">
                            <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
                                ホームに戻る
                            </Button>
                        </Link>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full max-w-none mx-auto flex-1 md:min-h-0 flex md:overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 p-4 lg:p-6">
                {/* STEP インジケータ付きの簡潔なヘッダー */}
                <div className="sticky top-0 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:backdrop-blur-none mb-3 sm:mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center shrink-0 gap-3">
                    <div className="text-left">
                        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground tracking-wide">
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                                1
                            </span>
                            <span>STEP 1 / 2 ・ 候補日程を選ぶ</span>
                        </div>
                        <h2 className="text-lg sm:text-xl font-bold mt-1">
                            {siteConfig.ui.createEvent.title}
                        </h2>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        {selectedPeriods.length > 0 && (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                                {selectedPeriods.length} 候補選択中
                            </span>
                        )}
                        <Button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            disabled={selectedPeriods.length === 0}
                            size="sm"
                            className="shadow-sm"
                        >
                            次へ <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 md:min-h-0 relative w-full flex flex-col">
                    <div className="space-y-2 shrink-0 pb-2 top-0 bg-background/95 backdrop-blur z-10">
                        <div className="flex justify-between items-end flex-wrap gap-2">
                            <Tabs
                                value={selectionMode}
                                onValueChange={(value) => {
                                    const next = value as "timed" | "allday";
                                    if (next === selectionMode) return;
                                    if (selectedPeriods.length > 0) {
                                        setPendingMode(next);
                                    } else {
                                        setSelectionMode(next);
                                    }
                                }}
                            >
                                <TabsList className="h-8">
                                    <TabsTrigger value="timed" className="text-xs">時間帯で調整</TabsTrigger>
                                    <TabsTrigger value="allday" className="text-xs">日毎の出欠確認（終日）</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        {selectionMode === "timed" && (
                        <div className="flex gap-2 flex-wrap items-center">
                            <CalendarImportMenu
                                triggerLabel="自分の予定で候補をプレビュー"
                                title="自分の予定を取り込む"
                                description="自分の予定が入っている時間帯がカレンダー上で赤くハイライトされ、候補に選ばないよう避けやすくなります。"
                                enableCampusSquare={ENABLE_CAMPUS_SQUARE}
                                onGoogleImport={handleGoogleImport}
                                onGoogleImportLoading={isGoogleImporting}
                                onCampusImport={handleCampusSquareImport}
                                onICalImport={handleICalImport}
                            />
                        </div>
                        )}
                        </div>
                    </div>

                    <div className="flex-1 md:min-h-0 relative bg-transparent sm:bg-card/10 sm:border rounded-lg md:overflow-hidden flex flex-col">
                        {selectionMode === "timed" ? (
                            <PeriodSelector
                                selectedPeriods={selectedPeriods}
                                onChange={setSelectedPeriods}
                                busyPeriodIds={busyPeriodIds}
                                busyEvents={visibleBusyEvents}
                            />
                        ) : (
                            <AllDayRangeSelector
                                selected={selectedPeriods}
                                onChange={setSelectedPeriods}
                            />
                        )}
                    </div>
                </div>
            </div>

            <Dialog open={allDayChoice !== null} onOpenChange={(open) => { if (!open) finishAllDayChoice(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>終日の予定を反映しますか</DialogTitle>
                        <DialogDescription>
                            チェックした予定は、その日を一日中「予定あり」として赤く表示します。祝日など、候補選びに関係ない予定はチェックしないでください。
                        </DialogDescription>
                    </DialogHeader>
                    {allDayChoice && (
                        <ul className="max-h-72 overflow-y-auto rounded-md border divide-y">
                            {allDayChoice.events.slice(0, allDayChoice.showAll ? undefined : allDayChoice.nearCount).map((ev, i) => (
                                <li key={`${ev.start}|${ev.end}|${ev.summary}`}>
                                    <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 shrink-0 accent-primary"
                                            checked={allDayChoice.selected[i]}
                                            onChange={(e) => {
                                                const selected = [...allDayChoice.selected];
                                                selected[i] = e.target.checked;
                                                setAllDayChoice({ ...allDayChoice, selected });
                                            }}
                                        />
                                        <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatAllDayRange(ev)}</span>
                                        <span className="min-w-0 break-words">{ev.summary}</span>
                                    </label>
                                </li>
                            ))}
                            {!allDayChoice.showAll && allDayChoice.nearCount < allDayChoice.events.length && (
                                <li>
                                    <button
                                        type="button"
                                        className="w-full px-3 py-2 text-sm text-primary hover:bg-muted/50"
                                        onClick={() => setAllDayChoice({ ...allDayChoice, showAll: true })}
                                    >
                                        さらに先の予定も表示（{allDayChoice.events.length - allDayChoice.nearCount}件）
                                    </button>
                                </li>
                            )}
                        </ul>
                    )}
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button type="button" variant="outline" onClick={() => finishAllDayChoice(false)}>
                            終日の予定は反映しない
                        </Button>
                        <Button
                            type="button"
                            onClick={() => finishAllDayChoice(true)}
                            disabled={!allDayChoice?.selected.some(Boolean)}
                        >
                            {allDayChoice?.selected.some(Boolean)
                                ? `選んだ${allDayChoice.selected.filter(Boolean).length}件を反映`
                                : "反映する予定を選んでください"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Input Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>イベントの詳細を設定</DialogTitle>
                            <DialogDescription>
                                イベントのタイトルと説明を入力して作成を完了します。
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-6 py-6">
                            <div className="space-y-2">
                                <label htmlFor="title" className="text-sm font-medium leading-none">
                                    イベント名 <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="title"
                                    placeholder="例: プロジェクト会議、ランチなど"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    required
                                    maxLength={200}
                                    className="text-lg py-6 bg-background/50 backdrop-blur-sm"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="description" className="text-sm font-medium leading-none">
                                    説明 (任意)
                                </label>
                                <Input
                                    id="description"
                                    placeholder="詳細を追加..."
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="bg-background/50 backdrop-blur-sm"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="adminPassword" className="text-sm font-medium leading-none">
                                    管理者パスワード <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="adminPassword"
                                    type="password"
                                    placeholder="8文字以上"
                                    value={adminPassword}
                                    onChange={(e) => setAdminPassword(e.target.value)}
                                    required
                                    minLength={8}
                                    maxLength={256}
                                    className="bg-background/50 backdrop-blur-sm"
                                />
                                <p className="text-xs text-muted-foreground">管理画面の閲覧に必要です。忘れないようにしてください。</p>
                            </div>
                        </div>
                        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)} className="w-full sm:w-auto">
                                キャンセル
                            </Button>
                            <Button
                                type="submit"
                                disabled={!title.trim() || adminPassword.length < 8 || isSubmitting}
                                className="w-full sm:w-auto shadow-lg shadow-primary/20"
                            >
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                イベントを作成
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Restore Draft Dialog */}
            <Dialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>下書きの復元</DialogTitle>
                        <DialogDescription>
                            前回選択した日程のデータが残っています
                            {draftSavedAt && `（${format(new Date(draftSavedAt), "M月d日(E) HH:mm", { locale: ja })} 時点）`}
                            。復元して続きから作成しますか？
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button
                            variant="ghost"
                            onClick={() => {
                                localStorage.removeItem(DRAFT_KEY);
                                localStorage.removeItem(DRAFT_SAVED_AT_KEY);
                                setShowRestoreDialog(false);
                            }}
                        >
                            破棄する
                        </Button>
                        <Button
                            onClick={() => {
                                const savedDraft = localStorage.getItem(DRAFT_KEY);
                                if (savedDraft) {
                                    const parsed = JSON.parse(savedDraft) as string[];
                                    setSelectedPeriods(parsed);
                                    // 候補形式からモードを復元（全候補が終日なら終日モード）
                                    setSelectionMode(isAllDayEvent(parsed) ? "allday" : "timed");
                                }
                                setShowRestoreDialog(false);
                            }}
                        >
                            復元する
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* モード切替の確認: 選択済み候補はモード間で互換性がないため破棄する */}
            <ConfirmDialog
                open={pendingMode !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingMode(null);
                }}
                title="選択中の候補を破棄しますか？"
                description={`現在選択中の${selectedPeriods.length}件の候補は、調整方法を切り替えると全て削除されます。この操作は元に戻せません。`}
                confirmText="破棄して切り替える"
                cancelText="このままにする"
                onConfirm={() => {
                    if (pendingMode) {
                        setSelectedPeriods([]);
                        localStorage.removeItem(DRAFT_KEY);
                        setSelectionMode(pendingMode);
                    }
                    setPendingMode(null);
                }}
            />

            <Dialog open={feedback.isOpen} onOpenChange={closeFeedback}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{feedback.title}</DialogTitle>
                        <DialogDescription>
                            {feedback.message}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={closeFeedback}>閉じる</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
