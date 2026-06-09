"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";
import { PeriodSelector, CUSTOM_PERIODS } from "@/components/PeriodSelector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ParticipantComments } from "@/components/ParticipantComments";
import { CalendarExportDialog } from "@/components/CalendarExportDialog";
import { Check } from "lucide-react";
import { logActivity } from "@/hooks/useActivityLog";

type Props = {
    eventId: string;
    initialTitle: string;
    initialDescription: string;
    initialCandidates: string[];
    initialConfirmedCandidateIdx: number | null;
    participants: { id: string; name: string; comment: string | null }[];
    availabilities: { participantId: string; candidateIdx: number; status: number }[];
};

export function AdminEventSettings({
    eventId,
    initialTitle,
    initialDescription,
    initialCandidates,
    initialConfirmedCandidateIdx,
    participants,
    availabilities,
}: Props) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<"edit" | "confirm">("edit");
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
    const completeTimerRef = useRef<NodeJS.Timeout | null>(null);

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

    const confirmCandidate = async (idx: number | null) => {
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
                <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                    <p className="font-medium">Google カレンダー招待を送るには再ログインが必要です。</p>
                    <p className="mt-1 text-amber-900">
                        {googleSessionEmail ? `${googleSessionEmail} で連携済みですが、` : ""}
                        必要な権限が追加されたため、Google に再ログインして権限を更新してください。
                    </p>
                    <div className="mt-3 flex justify-end">
                        <Button
                            type="button"
                            onClick={() => {
                                const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
                                window.location.href = `/api/google/auth/start?returnTo=${returnTo}`;
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

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "edit" | "confirm")} className="w-full">
                <TabsList>
                    <TabsTrigger value="edit">予定の編集</TabsTrigger>
                    <TabsTrigger value="confirm">予定の確定</TabsTrigger>
                </TabsList>

                <TabsContent value="edit" className="space-y-2">
                    <label className="text-sm font-medium">候補日程を編集</label>
                    <div className="h-[720px] w-full">
                        <PeriodSelector
                            selectedPeriods={selectedPeriods}
                            onChange={setSelectedPeriods}
                            busyPeriodIds={[]}
                        />
                    </div>
                </TabsContent>

                <TabsContent value="confirm" className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">最終確定候補（カレンダー上で選択）</label>
                        <Button type="button" variant="outline" size="sm" disabled={isConfirming} onClick={() => confirmCandidate(null)}>
                            未確定に戻す
                        </Button>
                    </div>
                    <AvailabilityTimeline
                        candidates={sortedCandidates}
                        availabilities={sortedCandidates.map(() => 2)}
                        onStatusChange={() => { }}
                        okCounts={okCounts}
                        mode="admin"
                        confirmedCandidateIdx={confirmedCandidateIdx}
                        candidateStats={candidateStats}
                        candidateParticipants={candidateParticipants}
                        onConfirmCandidate={confirmCandidate}
                    />
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
        </form>
    );
}
