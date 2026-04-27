import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EventResultsCalendar } from "@/components/EventResultsCalendar";

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

    return (
        <div className="min-h-screen bg-background text-foreground p-2 sm:p-4 md:p-6 lg:p-8">
            <div className="w-full space-y-6">
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

                <EventResultsCalendar
                    eventId={id}
                    candidates={parsedEvent.candidates}
                    confirmedCandidateIdx={parsedEvent.confirmedCandidateIdx}
                />
            </div>
        </div>
    );
}
