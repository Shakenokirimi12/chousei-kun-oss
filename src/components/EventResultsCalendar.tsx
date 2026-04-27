"use client";

import { useEffect, useMemo, useState } from "react";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";

type Props = {
    eventId: string;
    candidates: string[];
    confirmedCandidateIdx: number | null;
};

type Participant = {
    id: string;
    name: string;
};

type Availability = {
    id: string;
    participantId: string;
    candidateIdx: number;
    status: number;
};

export function EventResultsCalendar({ eventId, candidates, confirmedCandidateIdx }: Props) {
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [availabilities, setAvailabilities] = useState<Availability[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch(`/api/events/${eventId}`);
                if (!res.ok) {
                    throw new Error(`Failed to fetch: ${res.status}`);
                }
                const data = await res.json() as {
                    participants?: Participant[];
                    availabilities?: Availability[];
                };
                setParticipants(data.participants || []);
                setAvailabilities(data.availabilities || []);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [eventId]);

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

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">読み込み中...</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">エラー: {error}</div>;
    }

    return (
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
    );
}
