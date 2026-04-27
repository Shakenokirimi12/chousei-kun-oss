import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

const EventResultsCalendar = dynamic(
    () => import("@/components/EventResultsCalendar").then((mod) => mod.EventResultsCalendar),
    {
    loading: () => (
        <div className="flex flex-col items-center justify-center p-20 gap-4">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-muted-foreground font-medium text-sm">結果を読み込み中...</p>
        </div>
    ),
});

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await getCloudflareContext();

    const event = await env.DB.prepare(
        "SELECT id, title, description, candidates, confirmed_candidate_idx FROM events WHERE id = ?"
    ).bind(id).first<{
        id: string;
        title: string;
        description: string | null;
        candidates: string;
        confirmed_candidate_idx: number | null;
    }>();

    if (!event) notFound();

    const parsedEvent = {
        id: event.id,
        title: event.title,
        description: event.description,
        candidates: JSON.parse(event.candidates) as string[],
        confirmedCandidateIdx: event.confirmed_candidate_idx,
    };

    const { results: participants } = await env.DB.prepare(
        "SELECT * FROM participants WHERE event_id = ?"
    ).bind(id).all();

    const { results: availabilities } = await env.DB.prepare(
        `SELECT a.* FROM availabilities a
         JOIN participants p ON a.participant_id = p.id
         WHERE p.event_id = ?`
    ).bind(id).all();

    return (
        <div className="min-h-screen bg-background text-foreground p-2 sm:p-4 md:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center gap-4">
                    <Link href={`/${id}`}>
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">回答結果</h1>
                        <p className="text-muted-foreground text-sm">{parsedEvent.title} の回答状況</p>
                    </div>
                </div>

                <div className="bg-card rounded-lg border shadow-sm p-4 overflow-hidden">
                    <EventResultsCalendar
                        candidates={parsedEvent.candidates}
                        confirmedCandidateIdx={parsedEvent.confirmedCandidateIdx}
                        availabilities={availabilities as any}
                    />
                </div>
            </div>
        </div>
    );
}
