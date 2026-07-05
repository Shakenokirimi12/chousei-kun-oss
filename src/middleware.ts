import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
    isMaintenanceMode,
    maintenanceHtml,
    MAINTENANCE_JSON_BODY,
    MAINTENANCE_RETRY_AFTER_SECONDS,
} from "@/lib/maintenance";

/**
 * メンテナンスモードの全サイトゲート。
 * Flagship の `maintenance-mode` が ON の間、ページは 503 + メンテ HTML、
 * API（/api/*）は 503 + JSON を返す。静的アセットは matcher で除外。
 */
export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function middleware(req: NextRequest) {
    const { env } = await getCloudflareContext({ async: true });

    if (!(await isMaintenanceMode(env))) {
        return NextResponse.next();
    }

    const headers = {
        "Retry-After": String(MAINTENANCE_RETRY_AFTER_SECONDS),
        "Cache-Control": "no-store",
    };

    if (req.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json(MAINTENANCE_JSON_BODY, { status: 503, headers });
    }

    return new NextResponse(maintenanceHtml(), {
        status: 503,
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
}
