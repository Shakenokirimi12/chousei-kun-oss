import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronRight, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { createDb } from "@/server/db/client";
import { createEventService } from "@/server/services";

const ResponseForm = dynamic(() => import('@/components/ResponseForm').then(mod => mod.ResponseForm), {
    loading: () => (
        <div className="flex flex-col items-center justify-center p-20 gap-4">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-muted-foreground font-medium text-sm">回答フォームを読み込み中...</p>
        </div>
    )
});

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await getCloudflareContext();
    const db = createDb(env.DB);
    const eventService = createEventService(db);

    const { event, participants, availabilities } = await eventService.getEventWithParticipantsAndAvailabilities(id);

    if (!event) {
        notFound();
    }

    async function revalidateEvent() {
        "use server";
        revalidatePath(`/${id}`);
    }

    return (
        <div className="min-h-screen bg-background text-foreground px-3 sm:px-4 md:px-6 lg:px-8 pt-8 sm:pt-10 lg:pt-12 pb-24">
            <div className="w-full space-y-6 sm:space-y-8">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4">
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight break-words">{event.title}</h1>
                        {event.description ? (
                            <p className="text-muted-foreground mt-1.5 sm:mt-2 text-sm sm:text-base lg:text-lg break-words">{event.description}</p>
                        ) : null}
                    </div>
                    <Link href={`/${id}/results`} className="w-full sm:w-auto shrink-0">
                        <Button variant="outline" className="gap-2 group w-full sm:w-auto">
                            結果を確認する
                            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Button>
                    </Link>
                </div>

                <ResponseForm
                    eventId={id}
                    candidates={event.candidates}
                    participants={participants}
                    allAvailabilities={availabilities}
                    onSuccess={revalidateEvent}
                />
            </div>
        </div>
    );
}
