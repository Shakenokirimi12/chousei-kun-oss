"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";
import { DailyAvailabilityList } from "@/components/DailyAvailabilityList";
import { PeriodSelector, CUSTOM_PERIODS } from "@/components/PeriodSelector";
import { AllDayRangeSelector } from "@/components/AllDayRangeSelector";
import { isAllDayEvent } from "@/lib/candidates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ParticipantComments } from "@/components/ParticipantComments";
import { CalendarExportDialog } from "@/components/CalendarExportDialog";
import { ConfirmedScheduleCard } from "@/components/ConfirmedScheduleCard";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Check, CircleCheck, CircleAlert, CircleX, Loader2, CalendarPlus } from "lucide-react";
import { logActivity } from "@/hooks/useActivityLog";

type Props = {
    eventId: string;
    initialTitle: string;
    initialDescription: string;
    initialCandidates: string[];
    initialConfirmedCandidateIdx: number | null;
    initialResultsVisibleToAll: boolean;
    participants: { id: string; name: string; comment: string | null; notificationEmail?: string | null }[];
    availabilities: { participantId: string; candidateIdx: number; status: number }[];
};

export function AdminEventSettings({
    eventId,
    initialTitle,
    initialDescription,
    initialCandidates,
    initialConfirmedCandidateIdx,
    initialResultsVisibleToAll,
    participants,
    availabilities,
}: Props) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<"edit" | "confirm" | "participants">("edit");
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription);
    const [selectedPeriods, setSelectedPeriods] = useState(initialCandidates);
    const [confirmedCandidateIdx, setConfirmedCandidateIdx] = useState<number | null>(initialConfirmedCandidateIdx);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [submitComplete, setSubmitComplete] = useState(false);
    const [error, setError] = useState<string>("");
    const [needsGoogleReauth, setNeedsGoogleReauth] = useState(false);
    const [googleSessionEmail, setGoogleSessionEmail] = useState<string>("");
    const [hasGoogleSession, setHasGoogleSession] = useState(false);
    const [showCalendarExportDialog, setShowCalendarExportDialog] = useState(false);
    const [pendingConfirmedIdx, setPendingConfirmedIdx] = useState<number | null>(null);
    const [pendingCandidateConfirmIdx, setPendingCandidateConfirmIdx] = useState<number | null>(null);
    const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const completeTimerRef = useRef<NodeJS.Timeout | null>(null);
    // 「日毎の出欠確認」イベントか。編集UIも終日用セレクタに切り替える（種別の変更は不可）
    const isDailyEvent = useMemo(() => isAllDayEvent(initialCandidates), [initialCandidates]);
    const [resultsVisibleToAll, setResultsVisibleToAll] = useState(initialResultsVisibleToAll);
    const [isSavingVisibility, setIsSavingVisibility] = useState(false);
    const [visibilityError, setVisibilityError] = useState("");

    const handleToggleResultsVisibility = async (checked: boolean) => {
        const previous = resultsVisibleToAll;
        setVisibilityError("");
        setResultsVisibleToAll(checked);
        setIsSavingVisibility(true);
        try {
            const res = await fetch(`/api/events/${eventId}/admin/results-visibility`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ resultsVisibleToAll: checked }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || "設定の更新に失敗しました。");
            }
            router.refresh();
        } catch (err) {
            setResultsVisibleToAll(previous);
            setVisibilityError(err instanceof Error ? err.message : "設定の更新に失敗しました。");
        } finally {
            setIsSavingVisibility(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        const loadGoogleSessionStatus = async () => {
            try {
                const res = await fetch("/api/google/session-status");
                if (!res.ok) return;
                const data = await res.json() as {
                    hasSession: boolean;
                    email: string | null;
                    hasCalendarWriteScope: boolean;
                };
                if (cancelled) return;
                setGoogleSessionEmail(data.email ?? "");
                setHasGoogleSession(data.hasSession && data.hasCalendarWriteScope);
                setNeedsGoogleReauth(data.hasSession && !data.hasCalendarWriteScope);
            } catch {
                // Ignore status check failures and keep the page usable.
            }
        };

        void loadGoogleSessionStatus();
        return () => {
            cancelled = true;
        };
    }, []);

    const sortedCandidates = useMemo(() => {
        return [...selectedPeriods].sort((a, b) => {
            const [dateA, slotA] = a.split("_");
            const [dateB, slotB] = b.split("_");
            if (dateA !== dateB) return dateA.localeCompare(dateB);
            const getStartTime = (slot: string) => {
                if (slot.startsWith("P")) {
                    const id = Number(slot.replace("P", ""));
                    return CUSTOM_PERIODS.find((x) => x.id === id)?.time.split("-")[0] ?? "00:00";
                }
                if (slot.startsWith("H")) {
                    const id = Number(slot.replace("H", ""));
                    return `${id.toString().padStart(2, "0")}:00`;
                }
                return "00:00";
            };
            const startA = getStartTime(slotA);
            const startB = getStartTime(slotB);
            return startA.localeCompare(startB);
        });
    }, [selectedPeriods]);

    const candidateStats = useMemo(() => {
        const stats = sortedCandidates.map(() => ({ ok: 0, maybe: 0, ng: 0 }));
        const oldCandidateToNewIndex = new Map<string, number>();
        sortedCandidates.forEach((candidate, idx) => oldCandidateToNewIndex.set(candidate, idx));

        availabilities.forEach((availability) => {
            const oldCandidate = initialCandidates[availability.candidateIdx];
            if (!oldCandidate) return;
            const newIdx = oldCandidateToNewIndex.get(oldCandidate);
            if (newIdx === undefined) return;

            if (availability.status === 2) stats[newIdx].ok += 1;
            else if (availability.status === 1) stats[newIdx].maybe += 1;
            else stats[newIdx].ng += 1;
        });
        return stats;
    }, [availabilities, initialCandidates, sortedCandidates]);

    const okCounts = useMemo(() => candidateStats.map((x) => x.ok), [candidateStats]);

    const participantNameById = useMemo(() => {
        const map = new Map<string, string>();
        participants.forEach((p) => {
            if (p.id && p.name) {
                map.set(p.id, p.name);
            }
        });
        return map;
    }, [participants]);

    const candidateParticipants = useMemo(() => {
        const participantsByCandidate = sortedCandidates.map(() => ({ ok: [] as string[], maybe: [] as string[], ng: [] as string[] }));
        const oldCandidateToNewIndex = new Map<string, number>();
        sortedCandidates.forEach((candidate, idx) => oldCandidateToNewIndex.set(candidate, idx));

        availabilities.forEach((availability) => {
            const oldCandidate = initialCandidates[availability.candidateIdx];
            if (!oldCandidate) return;
            const newIdx = oldCandidateToNewIndex.get(oldCandidate);
            if (newIdx === undefined) return;

            const name = participantNameById.get(availability.participantId);
            if (!name) return;

            if (availability.status === 2) participantsByCandidate[newIdx].ok.push(name);
            else if (availability.status === 1) participantsByCandidate[newIdx].maybe.push(name);
            else participantsByCandidate[newIdx].ng.push(name);
        });
        return participantsByCandidate;
    }, [availabilities, initialCandidates, sortedCandidates, participantNameById]);

    const participantSummaries = useMemo(() => {
        return participants.map((p) => {
            const responses = availabilities.filter((a) => a.participantId === p.id);
            let ok = 0, maybe = 0, ng = 0;
            for (const r of responses) {
                if (r.status === 2) ok++;
                else if (r.status === 1) maybe++;
                else ng++;
            }
            return { ...p, ok, maybe, ng, total: responses.length };
        });
    }, [participants, availabilities]);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitComplete(false);
        if (completeTimerRef.current) {
            clearTimeout(completeTimerRef.current);
        }
        if (!title.trim()) {
            setError("タイトルを入力してください。");
            return;
        }
        if (sortedCandidates.length === 0) {
            setError("候補日程を1件以上入力してください。");
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/events/${eventId}/admin`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim(),
                    candidates: sortedCandidates,
                }),
            });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                throw new Error(data.error || "更新に失敗しました。");
            }
            setSubmitComplete(true);
            completeTimerRef.current = setTimeout(() => {
                setSubmitComplete(false);
            }, 2000);
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "更新に失敗しました。");
        } finally {
            setIsSubmitting(false);
        }
    };

    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [isDuplicating, setIsDuplicating] = useState(false);
    const handleDuplicateEvent = async () => {
        setError("");
        setIsDuplicating(true);
        try {
            const res = await fetch(`/api/events/${eventId}/admin/duplicate`, { method: "POST" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || "複製に失敗しました。");
            }
            const data = await res.json() as { id: string };
            logActivity("イベント複製成功", data.id);
            router.push(`/${data.id}/admin`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "複製に失敗しました。");
        } finally {
            setIsDuplicating(false);
        }
    };
    const handleDeleteEvent = async () => {
        if (deleteConfirmText !== title) {
            setError("確認のためイベントタイトルをそのまま入力してください。");
            return;
        }
        setError("");
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || "削除に失敗しました。");
            }
            logActivity("イベント削除成功", eventId);
            router.push("/");
        } catch (err) {
            setError(err instanceof Error ? err.message : "削除に失敗しました。");
            setIsDeleting(false);
        }
    };

    // 「確定」は取り消せる操作だが、参加者から見える状態が変わるため確認を挟む。
    // 確定操作そのものはメール送信を行わない（招待送信は次のダイアログで任意に行う別操作）。
    const confirmCandidate = async (idx: number | null) => {
        if (idx !== null) {
            setPendingCandidateConfirmIdx(idx);
            return;
        }
        await performConfirmCandidate(null);
    };

    const performConfirmCandidate = async (idx: number | null) => {
        logActivity("日程確定開始", idx !== null ? `候補インデックス: ${idx}` : "確定解除");
        setError("");
        setIsConfirming(true);
        try {
            const res = await fetch(`/api/events/${eventId}/admin/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmedCandidateIdx: idx, skipCalendarInvite: true }),
            });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                logActivity("日程確定失敗", data.error || "不明なエラー");
                throw new Error(data.error || "確定に失敗しました。");
            }
            logActivity("日程確定成功", idx !== null ? `候補インデックス: ${idx}` : "確定解除");
            setConfirmedCandidateIdx(idx);
            
            if (idx !== null) {
                setPendingConfirmedIdx(idx);
                setShowCalendarExportDialog(true);
            }
            
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "確定に失敗しました。");
        } finally {
            setIsConfirming(false);
        }
    };

    const addToGoogleCalendar = async () => {
        if (pendingConfirmedIdx === null) return;
        
        const res = await fetch(`/api/events/${eventId}/admin/add-to-calendar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmedCandidateIdx: pendingConfirmedIdx }),
        });
        
        if (!res.ok) {
            const data = await res.json() as { error?: string };
            throw new Error(data.error || "Googleカレンダーへの追加に失敗しました。");
        }
    };

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            {needsGoogleReauth ? (
                <div className="rounded-md border bg-muted/30 p-4 text-sm">
                    <p className="font-medium">Google カレンダーへの招待送信には追加のログインが必要です。</p>
                    <p className="mt-1 text-muted-foreground">
                        {googleSessionEmail ? `${googleSessionEmail} で連携済みですが、` : ""}
                        カレンダー登録・招待送信の機能を使うには、Google に再ログインして権限を追加してください（使わない場合はそのままで問題ありません）。
                    </p>
                    <div className="mt-3 flex justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
                                // カレンダーへの予定作成・招待送信に使うため write スコープが必要
                                window.location.href = `/api/google/auth/start?returnTo=${returnTo}&scope=write`;
                            }}
                        >
                            Google に再ログイン
                        </Button>
                    </div>
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                    <label className="text-sm font-medium">イベント名</label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">説明</label>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
            </div>

            {isDailyEvent && (
                <div className="rounded-md border bg-card/40 p-4 space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={resultsVisibleToAll}
                            onChange={(e) => void handleToggleResultsVisibility(e.target.checked)}
                            disabled={isSavingVisibility}
                            className="h-4 w-4 mt-0.5 accent-primary"
                        />
                        <span className="text-sm">
                            <span className="font-medium">回答結果を参加者全員に公開する</span>
                            <span className="block text-xs text-muted-foreground mt-0.5">
                                オフにすると、参加者は結果ページで自分の回答内容のみ確認できます（他の参加者の名前・回答内訳は非表示）。確定した日程はオフでも表示されます。
                            </span>
                        </span>
                    </label>
                    {isSavingVisibility && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            保存中...
                        </p>
                    )}
                    {visibilityError && <p className="text-xs text-destructive">{visibilityError}</p>}
                </div>
            )}

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "edit" | "confirm" | "participants")} className="w-full">
                <TabsList>
                    <TabsTrigger value="edit">予定の編集</TabsTrigger>
                    <TabsTrigger value="confirm">予定の確定</TabsTrigger>
                    <TabsTrigger value="participants">参加者一覧 ({participants.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="edit" className="space-y-2">
                    <label className="text-sm font-medium">{isDailyEvent ? "候補の日を編集" : "候補日程を編集"}</label>
                    {isDailyEvent ? (
                        <AllDayRangeSelector
                            selected={selectedPeriods}
                            onChange={setSelectedPeriods}
                        />
                    ) : (
                        <div className="h-[720px] w-full">
                            <PeriodSelector
                                selectedPeriods={selectedPeriods}
                                onChange={setSelectedPeriods}
                                busyPeriodIds={[]}
                            />
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="participants" className="space-y-2">
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            asChild
                            disabled={participantSummaries.length === 0}
                        >
                            <a href={`/api/events/${eventId}/admin/export.csv`} download>
                                CSV をダウンロード
                            </a>
                        </Button>
                    </div>
                    {participantSummaries.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">まだ回答者はいません。</p>
                    ) : (
                        <>
                            {/* モバイル: カード形式（横スクロール・メール省略なし） */}
                            <div className="sm:hidden space-y-2">
                                {participantSummaries.map((p) => (
                                    <div key={p.id} className="rounded-md border p-3 space-y-2">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <p className="font-medium">{p.name}</p>
                                        </div>
                                        {p.notificationEmail && (
                                            <p className="text-xs text-muted-foreground break-all">{p.notificationEmail}</p>
                                        )}
                                        <div className="flex items-center gap-3 text-sm">
                                            <span className="inline-flex items-center gap-1 text-green-600">
                                                <CircleCheck className="h-4 w-4" aria-hidden="true" />○{p.ok}
                                            </span>
                                            <span className="inline-flex items-center gap-1 text-amber-500">
                                                <CircleAlert className="h-4 w-4" aria-hidden="true" />△{p.maybe}
                                            </span>
                                            <span className="inline-flex items-center gap-1 text-red-500">
                                                <CircleX className="h-4 w-4" aria-hidden="true" />×{p.ng}
                                            </span>
                                        </div>
                                        {p.comment && (
                                            <p className="text-xs text-muted-foreground border-t pt-2">{p.comment}</p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* デスクトップ/タブレット: 表形式 */}
                            <div className="hidden sm:block rounded-md border overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b bg-muted/50">
                                            <th className="text-left px-4 py-2 font-medium">名前</th>
                                            <th className="text-left px-4 py-2 font-medium">メールアドレス</th>
                                            <th className="text-center px-3 py-2 font-medium text-green-600">
                                                <span className="inline-flex items-center gap-1" aria-label="参加可能">
                                                    <CircleCheck className="h-4 w-4" aria-hidden="true" />○
                                                </span>
                                            </th>
                                            <th className="text-center px-3 py-2 font-medium text-amber-500">
                                                <span className="inline-flex items-center gap-1" aria-label="未定／調整可">
                                                    <CircleAlert className="h-4 w-4" aria-hidden="true" />△
                                                </span>
                                            </th>
                                            <th className="text-center px-3 py-2 font-medium text-red-500">
                                                <span className="inline-flex items-center gap-1" aria-label="参加不可">
                                                    <CircleX className="h-4 w-4" aria-hidden="true" />×
                                                </span>
                                            </th>
                                            <th className="text-left px-4 py-2 font-medium">コメント</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {participantSummaries.map((p) => (
                                            <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                                                <td className="px-4 py-2 font-medium whitespace-nowrap">{p.name}</td>
                                                <td className="px-4 py-2 text-muted-foreground break-all">{p.notificationEmail || "—"}</td>
                                                <td className="text-center px-3 py-2 text-green-600 tabular-nums">○{p.ok}</td>
                                                <td className="text-center px-3 py-2 text-amber-500 tabular-nums">△{p.maybe}</td>
                                                <td className="text-center px-3 py-2 text-red-500 tabular-nums">×{p.ng}</td>
                                                <td className="px-4 py-2 text-muted-foreground max-w-xs truncate">{p.comment || "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </TabsContent>

                <TabsContent value="confirm" className="space-y-3">
                    {confirmedCandidateIdx !== null && sortedCandidates[confirmedCandidateIdx] && (
                        <div className="space-y-2">
                            <ConfirmedScheduleCard
                                eventId={eventId}
                                eventTitle={title}
                                eventDescription={description}
                                confirmedCandidate={sortedCandidates[confirmedCandidateIdx]}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => {
                                    setPendingConfirmedIdx(confirmedCandidateIdx);
                                    setShowCalendarExportDialog(true);
                                }}
                            >
                                <CalendarPlus className="h-4 w-4" />
                                カレンダーに追加・招待を送る
                            </Button>
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                        <label className="text-sm font-medium">{isDailyEvent ? "最終確定日程（一覧から選択）" : "最終確定日程（カレンダー上で選択）"}</label>
                        <div className="flex items-center gap-2">
                            {isConfirming && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    処理中...
                                </span>
                            )}
                            <Button type="button" variant="outline" size="sm" disabled={isConfirming} onClick={() => confirmCandidate(null)}>
                                未確定に戻す
                            </Button>
                        </div>
                    </div>
                    {isDailyEvent ? (
                        <DailyAvailabilityList
                            candidates={sortedCandidates}
                            availabilities={sortedCandidates.map(() => 2)}
                            onStatusChange={() => { }}
                            okCounts={okCounts}
                            mode="admin"
                            confirmedCandidateIdx={confirmedCandidateIdx}
                            candidateStats={candidateStats}
                            candidateParticipants={candidateParticipants}
                            onConfirmCandidate={isConfirming ? undefined : confirmCandidate}
                        />
                    ) : (
                        <AvailabilityTimeline
                            candidates={sortedCandidates}
                            availabilities={sortedCandidates.map(() => 2)}
                            onStatusChange={() => { }}
                            okCounts={okCounts}
                            mode="admin"
                            confirmedCandidateIdx={confirmedCandidateIdx}
                            candidateStats={candidateStats}
                            candidateParticipants={candidateParticipants}
                            onConfirmCandidate={isConfirming ? undefined : confirmCandidate}
                        />
                    )}
                    <p className="text-xs text-muted-foreground">
                        現在の回答者数: {participants.length}人
                    </p>
                </TabsContent>
            </Tabs>

            <ParticipantComments participants={participants} />

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {activeTab === "edit" ? (
                <div className="flex justify-end pt-2">
                    <Button
                        type="submit"
                        disabled={isSubmitting || isConfirming}
                        className={`min-w-44 transition-colors ${submitComplete ? "bg-emerald-600 hover:bg-emerald-600" : ""}`}
                    >
                        {isSubmitting ? (
                            "保存中..."
                        ) : submitComplete ? (
                            <span className="flex items-center gap-2">
                                <Check className="h-4 w-4" />
                                保存完了
                            </span>
                        ) : (
                            "予定編集を保存"
                        )}
                    </Button>
                </div>
            ) : null}

            {pendingConfirmedIdx !== null && (
                <CalendarExportDialog
                    open={showCalendarExportDialog}
                    onOpenChange={setShowCalendarExportDialog}
                    eventTitle={title}
                    eventDescription={description}
                    confirmedCandidate={sortedCandidates[pendingConfirmedIdx] ?? ""}
                    hasGoogleSession={hasGoogleSession}
                    onAddToGoogleCalendar={addToGoogleCalendar}
                />
            )}

            <ConfirmDialog
                open={pendingCandidateConfirmIdx !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingCandidateConfirmIdx(null);
                }}
                title="この日程で確定しますか？"
                description="確定すると参加者の結果ページに表示されます。この操作自体は招待メールを送信しません（送信するかどうかは次の画面で選べます）。後から「未確定に戻す」で取り消せます。"
                confirmText="確定する"
                destructive={false}
                onConfirm={() => {
                    if (pendingCandidateConfirmIdx !== null) void performConfirmCandidate(pendingCandidateConfirmIdx);
                    setPendingCandidateConfirmIdx(null);
                }}
            />

            <ConfirmDialog
                open={showDuplicateConfirm}
                onOpenChange={setShowDuplicateConfirm}
                title="イベントを複製しますか？"
                description="同じ候補日程・説明・管理者パスワードで新しいイベントを作成します。回答はコピーされません。"
                confirmText="複製する"
                destructive={false}
                onConfirm={handleDuplicateEvent}
            />

            <ConfirmDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title="本当に完全削除しますか？"
                description={`「${title}」とその参加者・回答をすべて削除します。この操作は取り消せません。`}
                confirmText="完全に削除する"
                destructive
                onConfirm={handleDeleteEvent}
            />

            {/* 設定操作 */}
            <div className="mt-12 rounded-md border bg-card/40 p-4 space-y-3">
                <div>
                    <h3 className="text-sm font-semibold">このイベントを複製</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        同じ候補日程・説明・管理者パスワードで新しいイベントを作成します。回答はコピーされません。
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    disabled={isDuplicating}
                    onClick={() => setShowDuplicateConfirm(true)}
                >
                    {isDuplicating ? "複製中..." : "イベントを複製"}
                </Button>
            </div>

            {/* 危険な操作: 完全削除 */}
            <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                <div>
                    <h3 className="text-sm font-semibold text-destructive">イベントを完全削除</h3>
                    <p className="text-xs font-medium text-destructive/90 mt-1">
                        {participants.length > 0
                            ? `参加者${participants.length}人分の回答を含め、`
                            : ""}
                        イベント本体・参加者・回答をすべて削除します。この操作は取り消せません。
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        確認のため、下にイベントタイトル「{title}」をそのまま入力してください。
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder={title}
                        disabled={isDeleting}
                        className="sm:max-w-xs"
                    />
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={isDeleting || deleteConfirmText !== title}
                        onClick={() => setShowDeleteConfirm(true)}
                    >
                        {isDeleting ? "削除中..." : "完全に削除する"}
                    </Button>
                </div>
            </div>
        </form>
    );
}
