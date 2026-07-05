import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiApp } from "@/server/api/app";

export async function handleApiRequest(request: Request) {
    try {
        const { env, ctx } = await getCloudflareContext();
        // ctx (ExecutionContext) を Hono に渡さないと c.executionCtx が無く、
        // onError の waitUntil(Wana 送信) が登録されず応答後に打ち切られる。
        const response = await apiApp.fetch(request, env, ctx);

        // Next.js may strip headers from redirect responses returned directly.
        // Re-construct the response to ensure all headers (especially Set-Cookie) survive.
        const headers = new Headers();
        response.headers.forEach((value, key) => {
            headers.append(key, value);
        });
        if (!headers.has("Cache-Control")) {
            headers.set("Cache-Control", "no-store, max-age=0");
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
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
