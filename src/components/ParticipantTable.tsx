"use client";

import { memo, useMemo } from "react";
import { Circle, Triangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCandidateLabel } from "@/lib/candidates";

type Participant = {
    id: string;
    name: string;
    comment: string | null;
};

type Availability = {
    participantId: string;
    candidateIdx: number;
    status: number; // 0=X, 1=Tri, 2=O
};

type Props = {
    candidates: string[];
    confirmedCandidateIdx: number | null;
    participants: Participant[];
    availabilities: Availability[];
};

const statusIcon = (status: number | undefined) => {
    switch (status) {
        case 0: return <X className="w-5 h-5 text-red-500 mx-auto" aria-label="×" />;
        case 1: return <Triangle className="w-5 h-5 text-yellow-500 mx-auto" aria-label="△" />;
        case 2: return <Circle className="w-5 h-5 text-green-500 mx-auto" aria-label="○" />;
        default: return <span className="text-muted-foreground"><span aria-hidden="true">-</span><span className="sr-only">回答なし</span></span>;
    }
};

/**
 * 回答者ごとの ○△× を表で見せる。タイムラインは候補ごとの人数しか出さないので、
 * 「誰が来られないか」を確かめるにはこの表が要る。
 */
export const ParticipantTable = memo(function ParticipantTable({ candidates, confirmedCandidateIdx, participants, availabilities }: Props) {
    const statusByKey = useMemo(() => {
        const map = new Map<string, number>();
        availabilities.forEach((a) => map.set(`${a.participantId}:${a.candidateIdx}`, Number(a.status)));
        return map;
    }, [availabilities]);

    const okCounts = useMemo(
        () => candidates.map((_, idx) => participants.filter((p) => statusByKey.get(`${p.id}:${idx}`) === 2).length),
        [candidates, participants, statusByKey]
    );

    if (participants.length === 0) return null;

    return (
        <section className="space-y-2">
            <h2 className="text-base font-semibold">回答者ごとの一覧</h2>
            <div className="overflow-x-auto rounded-md border bg-card">
                <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/50">
                        <tr className="border-b">
                            <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground min-w-[8rem] sticky left-0 z-10 bg-muted border-r">
                                回答者
                            </th>
                            {candidates.map((c, idx) => (
                                <th
                                    key={c}
                                    scope="col"
                                    className={cn(
                                        "px-2 py-2 text-center font-medium whitespace-nowrap border-l min-w-[5.5rem]",
                                        confirmedCandidateIdx === idx ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "text-muted-foreground"
                                    )}
                                >
                                    {formatCandidateLabel(c)}
                                    {confirmedCandidateIdx === idx ? <span className="block text-xs font-bold">確定</span> : null}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {participants.map((p) => (
                            <tr key={p.id} className="border-b last:border-0">
                                <th scope="row" className="px-3 py-2 text-left font-medium sticky left-0 z-10 bg-card border-r">
                                    <span className="block max-w-[10rem] truncate" title={p.name}>{p.name}</span>
                                </th>
                                {candidates.map((c, idx) => (
                                    <td
                                        key={c}
                                        className={cn("px-2 py-2 text-center border-l", confirmedCandidateIdx === idx && "bg-emerald-50 dark:bg-emerald-950/30")}
                                    >
                                        {statusIcon(statusByKey.get(`${p.id}:${idx}`))}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t-2 bg-muted/30 font-semibold">
                            <th scope="row" className="px-3 py-2 text-left sticky left-0 z-10 bg-muted border-r">
                                ○の人数
                            </th>
                            {okCounts.map((n, idx) => (
                                <td key={candidates[idx]} className="px-2 py-2 text-center border-l tabular-nums">
                                    {n}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
    );
});
