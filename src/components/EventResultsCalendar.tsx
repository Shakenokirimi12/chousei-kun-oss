"use client";

import { useMemo } from "react";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";

type Props = {
    candidates: string[];
    confirmedCandidateIdx: number | null;
    availabilities: { candidate_idx: number; status: number }[];
};

export function EventResultsCalendar({ candidates, confirmedCandidateIdx, availabilities }: Props) {
    const candidateStats = useMemo(() => {
        const stats = candidates.map(() => ({ ok: 0, maybe: 0, ng: 0 }));
        availabilities.forEach((a) => {
            if (a.candidate_idx < 0 || a.candidate_idx >= stats.length) return;
            if (a.status === 2) stats[a.candidate_idx].ok += 1;
            else if (a.status === 1) stats[a.candidate_idx].maybe += 1;
            else stats[a.candidate_idx].ng += 1;
        });
        return stats;
    }, [availabilities, candidates]);

    const okCounts = useMemo(() => candidateStats.map((x) => x.ok), [candidateStats]);

    return (
        <AvailabilityTimeline
            candidates={candidates}
            availabilities={candidates.map(() => 2)}
            onStatusChange={() => { }}
            okCounts={okCounts}
            mode="results"
            confirmedCandidateIdx={confirmedCandidateIdx}
            candidateStats={candidateStats}
        />
    );
}
