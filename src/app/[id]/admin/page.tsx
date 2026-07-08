import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { siteConfig } from "@/config/site";
import { AdminEventSettings } from "@/components/AdminEventSettings";
import { AdminSessionActions } from "@/components/AdminSessionActions";
import { createDb } from "@/server/db/client";
import { createEventService } from "@/server/services";

export default async function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env } = await getCloudflareContext();
  const db = createDb(env.DB);
  const eventService = createEventService(db);

  const event = await eventService.findByIdForAdmin(id);

  if (!event) {
    notFound();
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(`chousei_admin_${id}`)?.value;
  if (!event.adminAccessToken || sessionCookie !== event.adminAccessToken) {
    redirect(`/${id}/admin/login`);
  }

  const [participants, availabilities] = await Promise.all([
    eventService.getParticipants(id),
    eventService.getAvailabilities(id),
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground p-2 sm:p-4 md:p-6 lg:p-8">
      <div className="w-full space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-2xl font-bold shrink-0">{siteConfig.ui.admin.title}</h1>
            <p className="text-muted-foreground text-sm truncate" title={`${event.title} の管理設定`}>
              {event.title} の管理設定
            </p>
          </div>
          <AdminSessionActions eventId={id} />
        </div>

        <AdminEventSettings
          eventId={id}
          initialTitle={event.title}
          initialDescription={event.description ?? ""}
          initialCandidates={event.candidates}
          initialConfirmedCandidateIdx={event.confirmedCandidateIdx ?? null}
          initialResultsVisibleToAll={event.resultsVisibleToAll === 1}
          participants={participants.map((p) => ({
            id: p.id,
            name: p.name,
            comment: p.comment,
            notificationEmail: p.notificationEmail,
          }))}
          availabilities={availabilities}
        />
      </div>
    </div>
  );
}
