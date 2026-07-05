import { handleApiRequest } from "@/server/api/handler";

export const GET = handleApiRequest;
// 管理者によるイベント削除（Hono の eventsRoutes.delete("/:id")）。
// これが無いと Next が DELETE を 405 にしてしまい、削除 UI が機能しない。
export const DELETE = handleApiRequest;
