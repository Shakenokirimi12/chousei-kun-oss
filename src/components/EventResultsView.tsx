"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";
import { ParticipantComments } from "@/components/ParticipantComments";
import { ConfirmedScheduleCard } from "@/components/ConfirmedScheduleCard";

type Participant = {
    id: string;
    name: string;
    comment: string | null;
};

type Availability = {
    participantId: string;
    candidateIdx: number;
    status: number;
};

type Props = {
    eventId: string;
    eventTitle: string;
    eventDescription?: string | null;
    candidates: string[];
    confirmedCandidateIdx: number | null;
    participants: Participant[];
    availabilities: Availability[];
};

export const EventResultsView = memo(function EventResultsView({ 
    eventId,
    eventTitle,
    eventDescription,
    candidates, 
    confirmedCandidateIdx, 
    participants, 
    availabilities 
}: Props) {
    const participantNameById = useMemo(() => {
        const map = new Map<string, string>();
        participants.forEach((p) => {
            const id = String(p.id ?? "");
            const name = String(p.name ?? "").trim();
            if (!id || !name) return;
            map.set(id, name);
        });
        return map;
    }, [participants]);

    const candidateStats = useMemo(() => {
        const stats = candidates.map(() => ({ ok: 0, maybe: 0, ng: 0 }));
        availabilities.forEach((a) => {
            const candidateIdx = Number(a.candidateIdx);
            const status = Number(a.status);
            if (!Number.isInteger(candidateIdx) || candidateIdx < 0 || candidateIdx >= stats.length) return;
            if (status === 2) stats[candidateIdx].ok += 1;
            else if (status === 1) stats[candidateIdx].maybe += 1;
            else stats[candidateIdx].ng += 1;
        });
        return stats;
    }, [availabilities, candidates]);

    const okCounts = useMemo(() => candidateStats.map((x) => x.ok), [candidateStats]);

    const candidateParticipants = useMemo(() => {
        const participantsByCandidate = candidates.map(() => ({ ok: [] as string[], maybe: [] as string[], ng: [] as string[] }));
        availabilities.forEach((a) => {
            const candidateIdx = Number(a.candidateIdx);
            const status = Number(a.status);
            if (!Number.isInteger(candidateIdx) || candidateIdx < 0 || candidateIdx >= participantsByCandidate.length) return;

            const participantId = String(a.participantId ?? "");
            const name = participantNameById.get(participantId);
            if (!name) return;

            if (status === 2) participantsByCandidate[candidateIdx].ok.push(name);
            else if (status === 1) participantsByCandidate[candidateIdx].maybe.push(name);
            else participantsByCandidate[candidateIdx].ng.push(name);
        });
        return participantsByCandidate;
    }, [availabilities, candidates, participantNameById]);

    const confirmedCandidate = confirmedCandidateIdx !== null ? candidates[confirmedCandidateIdx] : null;

    return (
        <div className="space-y-6">
            {confirmedCandidate && (
                <ConfirmedScheduleCard
                    eventId={eventId}
                    eventTitle={eventTitle}
                    eventDescription={eventDescription}
                    confirmedCandidate={confirmedCandidate}
                />
            )}
            {participants.length === 0 && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
                    <p className="mt-3 font-medium">まだ回答がありません</p>
                    <p className="mt-1 text-sm text-muted-foreground">最初の回答者になりましょう。</p>
                    <Link href={`/${eventId}`} className="inline-block mt-4">
                        <Button>回答する</Button>
                    </Link>
                </div>
            )}
            <AvailabilityTimeline
                candidates={candidates}
                availabilities={candidates.map(() => 2)}
                onStatusChange={() => { }}
                okCounts={okCounts}
                mode="results"
                confirmedCandidateIdx={confirmedCandidateIdx}
                candidateStats={candidateStats}
                candidateParticipants={candidateParticipants}
            />
            {participants.length > 0 && <ParticipantComments participants={participants} />}
        </div>
    );
});
