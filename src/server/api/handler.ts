import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiApp } from "@/server/api/app";

export async function handleApiRequest(request: Request) {
    try {
        const { env } = await getCloudflareContext();
        const response = await apiApp.fetch(request, env);
        
        // Ensure proper cache headers for API responses
        if (!response.headers.has("Cache-Control")) {
            response.headers.set("Cache-Control", "no-store, max-age=0");
        }
        
        return response;
    } catch (error) {
        console.error("[API Handler Error]", error);
        return new Response(
            JSON.stringify({ error: "Internal Server Error" }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store, max-age=0",
                },
            }
        );
    }
}
