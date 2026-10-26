import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { createDb } from "@/server/db/client";
import { createEventService } from "@/server/services";
import { AdminLoginForm } from "./AdminLoginForm";

// どのイベントの管理画面かを示すため、タイトルだけをサーバー側で引く。
// 公開 API は参加者の回答まで返すので、ログイン画面からは呼ばない。
export default async function AdminLoginPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await getCloudflareContext();
    const event = await createEventService(createDb(env.DB)).findByIdPublic(id);
    if (!event) notFound();
    return <AdminLoginForm eventTitle={event.title} />;
}
