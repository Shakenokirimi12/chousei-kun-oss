import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EventResultsView } from "@/components/EventResultsView";
import { OwnResultsOnly } from "@/components/OwnResultsOnly";
import { ResultsRestrictedNotice } from "@/components/ResultsRestrictedNotice";
import { createDb } from "@/server/db/client";
import { createEventService } from "@/server/services";

export default async function ResultsPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ pid?: string }>;
}) {
    const { id } = await params;
    const { pid } = await searchParams;
    const { env } = await getCloudflareContext();
    const db = createDb(env.DB);
    const eventService = createEventService(db);

    const [{ event, participants, availabilities }, eventAuth] = await Promise.all([
        eventService.getEventWithParticipantsAndAvailabilities(id),
        eventService.findByIdWithAuth(id),
    ]);

    if (!event) notFound();

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(`chousei_admin_${id}`)?.value;
    const isAdmin = !!eventAuth?.adminAccessToken && sessionCookie === eventAuth.adminAccessToken;

    const restricted = event.resultsVisibleToAll === 0 && !isAdmin;
    const ownParticipant = restricted && pid ? participants.find((p) => p.id === pid) : undefined;

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

                {restricted ? (
                    ownParticipant ? (
                        <OwnResultsOnly
                            eventId={id}
                            eventTitle={event.title}
                            eventDescription={event.description}
                            candidates={event.candidates}
                            confirmedCandidateIdx={event.confirmedCandidateIdx}
                            ownStatusByIdx={Object.fromEntries(
                                availabilities
                                    .filter((a) => a.participantId === ownParticipant.id)
                                    .map((a) => [a.candidateIdx, a.status])
                            )}
                        />
                    ) : (
                        <ResultsRestrictedNotice eventId={id} alreadyAttempted={!!pid} />
                    )
                ) : (
                    <EventResultsView
                        eventId={id}
                        eventTitle={event.title}
                        eventDescription={event.description}
                        candidates={event.candidates}
                        confirmedCandidateIdx={event.confirmedCandidateIdx}
                        participants={participants}
                        availabilities={availabilities}
                    />
                )}
            </div>
        </div>
    );
}
