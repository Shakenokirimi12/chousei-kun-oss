"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOM_PERIODS, HOURLY_SLOTS } from "./PeriodSelector";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";
import { cn } from "@/lib/utils";
import { Check, X, Triangle, Circle, Loader2, Calendar as CalendarIcon } from "lucide-react";
import { siteConfig } from "@/config/site";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import dynamic from 'next/dynamic';

const CampusSquareImport = dynamic(() => import('@/components/CampusSquareImport'), { ssr: false });


interface ResponseFormProps {
    eventId: string;
    candidates: string[];
    participants: { id: string, name: string, comment: string }[];
    allAvailabilities: { participant_id: string, candidate_idx: number, status: number }[];
    onSuccess: () => Promise<void>;
}

export function ResponseForm({ eventId, candidates, participants, allAvailabilities, onSuccess }: ResponseFormProps) {
    const router = useRouter();
    const [name, setName] = React.useState("");
    const [comment, setComment] = React.useState("");
    const [availabilities, setAvailabilities] = React.useState<number[]>(
        new Array(candidates.length).fill(2) // Default to 'O'
    );
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [participantId, setParticipantId] = React.useState<string | null>(null);

    // Import Dialog State
    const ENABLE_CAMPUS_SQUARE = process.env.NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE === 'true';

    const [feedback, setFeedback] = React.useState<{ title: string; message: string; isOpen: boolean }>({
        title: "",
        message: "",
        isOpen: false,
    });

    const closeFeedback = () => setFeedback(prev => ({ ...prev, isOpen: false }));

    // Calculate aggregated OK counts for each candidate slot
    const okCounts = React.useMemo(() => {
        const counts = new Array(candidates.length).fill(0);
        allAvailabilities.forEach(a => {
            if (a.candidate_idx < candidates.length && a.status === 2) {
                counts[a.candidate_idx]++;
            }
        });
        return counts;
    }, [allAvailabilities, candidates.length]);

    // Bulk actions
    const setAllStatus = (status: number) => {
        setAvailabilities(new Array(candidates.length).fill(status));
    };

    const handleDayStatusChange = (dateStr: string, status: number) => {
        setAvailabilities(prev => {
            const next = [...prev];
            candidates.forEach((c, idx) => {
                if (c.startsWith(dateStr)) {
                    next[idx] = status;
                }
            });
            return next;
        });
    };

    // Load existing participant from localStorage
    React.useEffect(() => {
        const storedId = localStorage.getItem(`chosei_participant_${eventId}`);
        if (storedId) {
            const existingParticipant = participants.find(p => p.id === storedId);
            if (existingParticipant) {
                setParticipantId(storedId);
                setName(existingParticipant.name);
                setComment(existingParticipant.comment || "");

                // Reconstruct availabilities
                const myAvails = allAvailabilities.filter(a => a.participant_id === storedId);
                const newAvails = new Array(candidates.length).fill(2); // Default to O
                // Note: If no availability record exists for a candidate, it remains default.
                // But usually we save all.
                myAvails.forEach(a => {
                    if (a.candidate_idx < newAvails.length) {
                        newAvails[a.candidate_idx] = a.status;
                    }
                });
                setAvailabilities(newAvails);
            } else {
                // Stored ID not found in server data (maybe deleted), clear it
                localStorage.removeItem(`chosei_participant_${eventId}`);
            }
        }
    }, [eventId, participants, allAvailabilities, candidates.length]);

    // Helper to parse candidate string "YYYY-MM-DD_P#" or legacy "YYYY-MM-DD_H#"
    const parseCandidate = React.useCallback((candidate: string) => {
        const [datePart, slotId] = candidate.split("_");
        const date = new Date(datePart);

        let period = null;
        const type = slotId.charAt(0);
        const id = parseInt(slotId.substring(1));

        if (type === "P") {
            period = CUSTOM_PERIODS.find((p: any) => p.id === id);
        } else if (type === "H") {
            period = HOURLY_SLOTS.find(h => h.id === id);
        } else {
            // Fallback for old data (assuming it was a period ID directly)
            const pid = parseInt(slotId);
            period = CUSTOM_PERIODS.find((p: any) => p.id === pid);
        }

        return { date, period };
    }, []);

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

        const data = await res.json() as { events: { dtstart: string, dtend: string }[] };

        // Conflict Detection
        const newAvailabilities = [...availabilities];
        let conflictCount = 0;

        candidates.forEach((candidate, idx) => {
            const { date, period } = parseCandidate(candidate);
            if (!period) return;

            const [startH, startM] = period.time.split("-")[0].split(":").map(Number);
            const [endH, endM] = period.time.split("-")[1].split(":").map(Number);
            const dateOnly = new Date(date);
            dateOnly.setHours(0, 0, 0, 0);

            const cStart = new Date(dateOnly);
            cStart.setHours(startH, startM, 0, 0);
            const cEnd = new Date(dateOnly);
            cEnd.setHours(endH, endM, 0, 0);

            // Check against each imported event
            const hasConflict = data.events.some(ev => {
                const eStart = new Date(ev.dtstart);
                const eEnd = new Date(ev.dtend);
                return cStart < eEnd && cEnd > eStart;
            });

            if (hasConflict) {
                newAvailabilities[idx] = 0; // Mark as X
                conflictCount++;
            }
        });

        setAvailabilities(newAvailabilities);

        if (conflictCount > 0) {
            setFeedback({
                title: "インポート成功",
                message: `スケジュールをインポートしました。${conflictCount}件の重複スロットを「×」に設定しました。`,
                isOpen: true
            });
        } else {
            setFeedback({
                title: "インポート成功",
                message: "スケジュールをインポートしました。候補日程との重複はありませんでした。",
                isOpen: true
            });
        }
    }

    const handleGoogleImport = () => {
        const gasUrl = "https://script.google.com/macros/s/AKfycbxNI455hdkBLblowRBy00ok0VuF445oz60c8lCqvsUWN4v4H8SIclThLwXw9IDZoi6X/exec";
        window.open(gasUrl, "GoogleCalendarSync", "width=600,height=800");
    };

    React.useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data && event.data.type === 'GOOGLE_CALENDAR_EVENTS') {
                const gasData = event.data.data;
                const events = gasData.events;

                setAvailabilities(prevAvailabilities => {
                    const nextAvailabilities = [...prevAvailabilities];
                    let conflictCount = 0;

                    candidates.forEach((candidate, idx) => {
                        const { date: cDate, period: cPeriod } = parseCandidate(candidate);
                        if (!cPeriod) return;

                        const [startH, startM] = cPeriod.time.split("-")[0].split(":").map(Number);
                        const [endH, endM] = cPeriod.time.split("-")[1].split(":").map(Number);

                        const cStart = new Date(cDate);
                        cStart.setHours(startH, startM, 0, 0);
                        const cEnd = new Date(cDate);
                        cEnd.setHours(endH, endM, 0, 0);

                        const hasConflict = events.some((ev: any) => {
                            const eStart = new Date(ev.dtstart || ev.start);
                            const eEnd = new Date(ev.dtend || ev.end);
                            return cStart < eEnd && cEnd > eStart;
                        });

                        if (hasConflict) {
                            nextAvailabilities[idx] = 0; // Mark as X
                            conflictCount++;
                        }
                    });

                    setFeedback({
                        title: "Googleカレンダー連携成功",
                        message: `${conflictCount}件の重複スロットを自動的に「×」に設定しました。`,
                        isOpen: true
                    });

                    return nextAvailabilities;
                });
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [candidates]);

    const handleStatusChange = (idx: number, status: number) => {
        setAvailabilities(prev => {
            const next = [...prev];
            next[idx] = status;
            return next;
        });
    };

    const getStatusIcon = (status: number) => {
        switch (status) {
            case 0: return <X className="w-6 h-6 text-red-500" />;
            case 1: return <Triangle className="w-6 h-6 text-yellow-500" />;
            case 2: return <Circle className="w-6 h-6 text-green-500" />;
            default: return null;
        }
    };

    const handleSubmit = async () => {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/events/${eventId}/participate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: trimmedName,
                    comment,
                    availabilities,
                    participantId: participantId || undefined
                })
            });

            if (!res.ok) throw new Error("送信に失敗しました");

            const data = await res.json() as { participantId: string };
            // Store ID for future edits
            if (data.participantId) {
                localStorage.setItem(`chosei_participant_${eventId}`, data.participantId);
                setParticipantId(data.participantId);
            }

            await onSuccess();
            // Don't clear form if editing, just refresh to show updated data?
            // Actually router.refresh() in onSuccess usually handles update.
            // If we want to show "Submitted!", maybe we can.
            // But if we are "editing", we persist the state.
            if (!participantId) {
                // If it was a new submission, keep the specific ID and state so they can edit it immediately if they want.
                // So we DON'T clear name/comment.
            }
            setFeedback({
                title: "成功",
                message: participantId ? "回答を更新しました！" : "回答を送信しました！",
                isOpen: true
            });
            router.refresh();
        } catch (err: any) {
            console.error(err);
            setFeedback({
                title: "エラー",
                message: "回答の送信に失敗しました。もう一度お試しください。",
                isOpen: true
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="w-full mt-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h3 className="text-2xl font-bold">
                        {participantId ? siteConfig.ui.responseEvent.titleEdit : siteConfig.ui.responseEvent.titleNew}
                    </h3>
                    <p className="text-muted-foreground">
                        {participantId
                            ? siteConfig.ui.responseEvent.descriptionEdit
                            : siteConfig.ui.responseEvent.descriptionNew}
                    </p>
                </div>
                {/* <Button variant="outline" size="sm" type="button" onClick={handleGoogleImport} className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    Googleカレンダー
                </Button> */}
                {ENABLE_CAMPUS_SQUARE && (
                    <CampusSquareImport
                        onImport={handleCampusSquareImport}
                        buttonLabel="時間割をインポート"
                        description="スケジュールの重複を確認します。重複するスロットは自動的に「×」に設定されます。"
                        actionLabel="インポートして重複を確認"
                    />
                )}
            </div>

            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            お名前
                        </label>
                        <Input
                            placeholder="名前を入力してください"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            className="bg-background/50 backdrop-blur-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            コメント (任意)
                        </label>
                        <Input
                            placeholder="メッセージがあれば入力してください"
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            className="bg-background/50 backdrop-blur-sm"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <label className="text-sm font-medium leading-none">
                        出欠を選択 (カレンダー内をタップして切り替え)
                    </label>
                    <div className="flex flex-wrap gap-2 mb-2">
                        <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => setAllStatus(2)}
                            className="bg-green-500/5 hover:bg-green-500/10 text-green-600 border-green-200"
                        >
                            <Circle className="w-3 h-3 mr-1" /> 全て○にする
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => setAllStatus(0)}
                            className="bg-red-500/5 hover:bg-red-500/10 text-red-600 border-red-200"
                        >
                            <X className="w-3 h-3 mr-1" /> 全て×にする
                        </Button>
                    </div>
                    <AvailabilityTimeline
                        candidates={candidates}
                        availabilities={availabilities}
                        onStatusChange={handleStatusChange}
                        onDayStatusChange={handleDayStatusChange}
                        busyPeriods={[]} // We could pass actual busy periods if we fetch them for current user
                        okCounts={okCounts}
                    />
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground justify-center py-2">
                        <div className="flex items-center gap-1.5">
                            <Circle className="w-3 h-3 text-green-500" /> 参加可能
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Triangle className="w-3 h-3 text-yellow-500" /> 調整中
                        </div>
                        <div className="flex items-center gap-1.5">
                            <X className="w-3 h-3 text-red-500" /> 不参加
                        </div>
                    </div>
                </div>

                <div className="pt-4">
                    <Button
                        className="w-full shadow-lg shadow-primary/20"
                        size="lg"
                        onClick={handleSubmit}
                        disabled={!name.trim() || isSubmitting}
                    >
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {participantId ? "回答を更新" : "回答を送信"}
                    </Button>
                </div>
            </div>

            {/* Feedback Dialog */}
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
