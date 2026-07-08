import { Circle, Triangle, X } from "lucide-react";
import { formatAllDayCandidateLabelLong } from "@/lib/candidates";
import { ConfirmedScheduleCard } from "@/components/ConfirmedScheduleCard";

type Props = {
    eventId: string;
    eventTitle: string;
    eventDescription?: string | null;
    candidates: string[];
    confirmedCandidateIdx: number | null;
    ownStatusByIdx: Record<number, number>;
};

const STATUS_META = {
    2: { icon: Circle, label: "いる", className: "text-green-600" },
    1: { icon: Triangle, label: "未定", className: "text-yellow-500" },
    0: { icon: X, label: "いない", className: "text-red-500" },
} as const;

export function OwnResultsOnly({
    eventId,
    eventTitle,
    eventDescription,
    candidates,
    confirmedCandidateIdx,
    ownStatusByIdx,
}: Props) {
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
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                このイベントは回答結果が非公開に設定されています。ここではご自身の回答内容のみ表示しています。
            </div>
            <div className="rounded-md border divide-y">
                {candidates.map((candidate, idx) => {
                    const status = ownStatusByIdx[idx];
                    const meta = status === 0 || status === 1 || status === 2 ? STATUS_META[status] : null;
                    return (
                        <div key={candidate} className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium">{formatAllDayCandidateLabelLong(candidate)}</span>
                            {meta ? (
                                <span className={`inline-flex items-center gap-1.5 text-sm ${meta.className}`}>
                                    <meta.icon className="h-4 w-4" />
                                    {meta.label}
                                </span>
                            ) : (
                                <span className="text-sm text-muted-foreground">未回答</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
