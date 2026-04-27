import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { siteConfig } from "@/config/site";
import { AdminEventSettings } from "@/components/AdminEventSettings";

export default async function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env } = await getCloudflareContext();

  const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<{
    id: string;
    title: string;
    description: string | null;
    candidates: string;
    admin_access_token: string | null;
    confirmed_candidate_idx: number | null;
  }>();

  if (!event) {
    notFound();
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(`chousei_admin_${id}`)?.value;
  if (!event.admin_access_token || sessionCookie !== event.admin_access_token) {
    redirect(`/${id}/admin/login`);
  }

  // Parse candidates
  const parsedEvent = {
    id: event.id,
    title: event.title,
    description: event.description,
    candidates: JSON.parse(event.candidates as string) as string[],
    confirmedCandidateIdx: event.confirmed_candidate_idx,
  };

  const { results: participants } = await env.DB.prepare("SELECT * FROM participants WHERE event_id = ?").bind(id).all();

  // Get availabilities
  const { results: availabilities } = await env.DB.prepare(
    `SELECT a.* FROM availabilities a
       JOIN participants p ON a.participant_id = p.id
       WHERE p.event_id = ?`,
  )
    .bind(id)
    .all();

  return (
    <div className="min-h-screen bg-background text-foreground p-2 sm:p-4 md:p-6 lg:p-8">
      <div className="w-full space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">{siteConfig.ui.admin.title}</h1>
            <p className="text-muted-foreground text-sm">{(parsedEvent as any).title} の管理設定</p>
          </div>
        </div>

        <AdminEventSettings eventId={id} initialTitle={parsedEvent.title} initialDescription={parsedEvent.description ?? ""} initialCandidates={parsedEvent.candidates} initialConfirmedCandidateIdx={parsedEvent.confirmedCandidateIdx ?? null} participants={participants as any} availabilities={availabilities as any} />
      </div>
    </div>
  );
}
