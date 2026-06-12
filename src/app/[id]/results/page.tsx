import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EventResultsView } from "@/components/EventResultsView";
import { createDb } from "@/server/db/client";
import { createEventService } from "@/server/services";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await getCloudflareContext();
    const db = createDb(env.DB);
    const eventService = createEventService(db);

    const { event, participants, availabilities } = await eventService.getEventWithParticipantsAndAvailabilities(id);

    if (!event) notFound();

    return (
        <div className="min-h-screen bg-background text-foreground px-3 sm:px-4 md:px-6 lg:px-8 pt-8 sm:pt-10 lg:pt-12 pb-24">
            <div className="w-full space-y-6">
                <div className="flex items-center gap-3 sm:gap-4">
                    <Link href={`/${id}`} className="shrink-0">
                        <Button variant="ghost" size="icon" aria-label="回答画面に戻る">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div className="min-w-0">
                        <h1 className="text-xl sm:text-2xl font-bold">回答結果</h1>
                        <p className="text-muted-foreground text-xs sm:text-sm truncate">{event.title} の回答状況</p>
                    </div>
                </div>

                <EventResultsView
                    eventId={id}
                    eventTitle={event.title}
                    eventDescription={event.description}
                    candidates={event.candidates}
                    confirmedCandidateIdx={event.confirmedCandidateIdx}
                    participants={participants}
                    availabilities={availabilities}
                />
            </div>
        </div>
    );
}
