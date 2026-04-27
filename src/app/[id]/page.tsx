import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronRight, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

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

    const event = await env.DB.prepare("SELECT id, title, description, candidates FROM events WHERE id = ?").bind(id).first<{
        id: string;
        title: string;
        description: string | null;
        candidates: string;
    }>();

    if (!event) {
        notFound();
    }

    // Parse candidates
    const parsedEvent = {
        id: event.id,
        title: event.title,
        description: event.description ?? "",
        candidates: JSON.parse(event.candidates as string) as string[]
    };

    const { results: participants } = await env.DB.prepare("SELECT * FROM participants WHERE event_id = ?").bind(id).all();

    // Get availabilities
    const { results: availabilities } = await env.DB.prepare(
        `SELECT a.* FROM availabilities a
       JOIN participants p ON a.participant_id = p.id
       WHERE p.event_id = ?`
    ).bind(id).all();

    async function revalidateEvent() {
        "use server";
        revalidatePath(`/${id}`);
    }

    return (
        <div className="min-h-screen bg-background text-foreground p-2 sm:p-4 md:p-6 lg:p-8">
            <div className="w-full space-y-8">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight">{parsedEvent.title}</h1>
                        <p className="text-muted-foreground mt-2 text-lg">{parsedEvent.description}</p>
                    </div>
                    <Link href={`/${id}/results`}>
                        <Button variant="outline" className="gap-2 group">
                            結果を確認する
                            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Button>
                    </Link>
                </div>

                <ResponseForm
                    eventId={id}
                    candidates={parsedEvent.candidates}
                    participants={participants as any[]}
                    allAvailabilities={availabilities as any[]}
                    onSuccess={revalidateEvent}
                />
            </div>
        </div>
    );
}
