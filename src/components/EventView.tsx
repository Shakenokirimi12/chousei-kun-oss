"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CUSTOM_PERIODS, HOURLY_SLOTS } from "@/components/PeriodSelector";
import { cn } from "@/lib/utils";
import { Check, X, Triangle, Circle } from "lucide-react";
import { budouxify } from "@/lib/budoux";

interface Event {
    id: string;
    title: string;
    description: string;
    candidates: string[];
    confirmedCandidateIdx?: number | null;
}

interface Participant {
    id: string;
    name: string;
    comment: string;
}

interface Availability {
    participant_id: string;
    candidate_idx: number;
    status: number; // 0=X, 1=Tri, 2=O
}

interface EventViewProps {
    event: Event;
    participants: Participant[];
    availabilities: Availability[];
}

export function EventView({ event, participants, availabilities }: EventViewProps) {

    // Helper to parse candidate string "YYYY-MM-DD_P#" or legacy "YYYY-MM-DD_H#"
    const parseCandidate = (candidate: string) => {
        const [datePart, slotId] = candidate.split("_");
        const date = new Date(datePart);

        let period = null;
        if (slotId.startsWith("P")) {
            const pid = parseInt(slotId.substring(1));
            period = CUSTOM_PERIODS.find(p => p.id === pid);
        } else if (slotId.startsWith("H")) {
            const hid = parseInt(slotId.substring(1));
            period = HOURLY_SLOTS.find(h => h.id === hid);
        } else {
            // Fallback for old data or simpler format
            const pid = parseInt(slotId);
            period = CUSTOM_PERIODS.find(p => p.id === pid);
        }

        return { date, period };
    };

    const statusIcon = (status: number) => {
        switch (status) {
            case 0: return <X className="w-5 h-5 text-red-500 mx-auto" />;
            case 1: return <Triangle className="w-5 h-5 text-yellow-500 mx-auto" />;
            case 2: return <Circle className="w-5 h-5 text-green-500 mx-auto" />;
            default: return null;
        }
    };

    // Calculate scores for each candidate
    const scores = event.candidates.map((_, idx) => {
        let score = 0;
        participants.forEach(p => {
            const avail = availabilities.find(a => a.participant_id === p.id && a.candidate_idx === idx);
            if (avail) {
                if (avail.status === 2) score += 2; // O
                if (avail.status === 1) score += 1; // Triangle
            }
        });
        return score;
    });

    // Find max score to highlight
    const maxScore = Math.max(...scores, 0);

    return (
        <div className="w-full animate-in fade-in zoom-in duration-500">
            <div className="mb-6">
                <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                    {budouxify(event.title)}
                </h1>
                {event.description && (
                    <p className="text-lg text-muted-foreground mt-2 leading-relaxed" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                        {budouxify(event.description)}
                    </p>
                )}
            </div>

            <div className="overflow-x-auto rounded-xl border bg-card/50 backdrop-blur-sm shadow-sm">
                <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-muted/50">
                        <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                            <th className="h-14 px-4 text-left align-middle font-medium text-muted-foreground min-w-[150px] sticky left-0 bg-background/95 backdrop-blur z-10 border-r shadow-[4px_0_24px_-2px_rgba(0,0,0,0.1)]">
                                回答者
                            </th>
                            {event.candidates.map((c, idx) => {
                                const { date, period } = parseCandidate(c);
                                const highlight = scores[idx] === maxScore && participants.length > 0;
                                const confirmed = event.confirmedCandidateIdx === idx;
                                return (
                                    <th key={idx} className={cn(
                                        "h-14 px-2 align-middle font-medium text-muted-foreground border-l relative text-center min-w-[80px]",
                                        confirmed ? "bg-emerald-100/70 text-emerald-700 font-bold" : "",
                                        highlight && !confirmed ? "bg-primary/5 font-bold text-primary" : ""
                                    )}>
                                        <div className="flex flex-col items-center justify-center h-full py-1">
                                            <span className="text-xs uppercase text-muted-foreground/70">
                                                {date.toLocaleDateString('ja-JP', { weekday: 'short' })}
                                            </span>
                                            <span className="text-sm font-semibold leading-none my-0.5">
                                                {date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {period?.label}
                                            </span>
                                            {/* Highlight Badge */}
                                            {confirmed && (
                                                <div className="absolute top-1 left-1">
                                                    <span className="text-xs rounded bg-emerald-600 text-white px-1 py-0.5">確定</span>
                                                </div>
                                            )}
                                            {highlight && !confirmed && (
                                                <div className="absolute top-1 right-1">
                                                    <span className="flex h-2 w-2 rounded-full bg-primary" />
                                                </div>
                                            )}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {participants.length === 0 ? (
                            <tr>
                                <td colSpan={event.candidates.length + 1} className="p-8 text-center text-muted-foreground">
                                    まだ回答がありません。
                                </td>
                            </tr>
                        ) : (
                            participants.map(p => (
                                <tr key={p.id} className="border-b last:border-0 transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted group">
                                    <td className="p-4 align-middle font-medium sticky left-0 bg-background/95 backdrop-blur z-10 border-r shadow-[4px_0_24px_-2px_rgba(0,0,0,0.1)] group-hover:bg-muted/50">
                                        <div className="flex flex-col">
                                            <span className="text-base">{p.name}</span>
                                            {p.comment && (
                                                <span className="text-xs text-muted-foreground font-normal truncate max-w-[140px]">
                                                    {p.comment}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    {event.candidates.map((_, idx) => {
                                        const avail = availabilities.find(a => a.participant_id === p.id && a.candidate_idx === idx);
                                        const highlight = scores[idx] === maxScore;
                                        const confirmed = event.confirmedCandidateIdx === idx;
                                        return (
                                            <td key={idx} className={cn(
                                                "p-4 align-middle text-center border-l",
                                                confirmed ? "bg-emerald-100/60" : "",
                                                highlight && !confirmed ? "bg-primary/5" : ""
                                            )}>
                                                {avail ? statusIcon(avail.status) : "-"}
                                            </td>
                                        );
                                    })}

                                </tr>
                            ))
                        )}
                        {/* Summary Row */}
                        <tr className="bg-muted/30 font-semibold border-t-2 border-muted">
                            <td className="p-4 align-middle sticky left-0 bg-background/95 backdrop-blur z-10 border-r shadow-[4px_0_24px_-2px_rgba(0,0,0,0.1)]">
                                スコア
                            </td>
                            {scores.map((score, idx) => {
                                const highlight = score === maxScore && participants.length > 0;
                                const confirmed = event.confirmedCandidateIdx === idx;
                                return (
                                    <td key={idx} className={cn(
                                        "p-2 text-center border-l text-base",
                                        confirmed ? "text-emerald-700 font-bold bg-emerald-100/70" : "",
                                        highlight && !confirmed ? "text-primary font-bold bg-primary/10" : "",
                                        !highlight && !confirmed ? "text-muted-foreground" : ""
                                    )}>
                                        {score.toFixed(1)}
                                    </td>
                                )
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div >
    );
}
