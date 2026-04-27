import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiApp } from "@/server/api/app";

export async function handleApiRequest(request: Request) {
    const { env } = await getCloudflareContext();
    return apiApp.fetch(request, { DB: env.DB });
}
