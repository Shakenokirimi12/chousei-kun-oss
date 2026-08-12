import { handleApiRequest } from "@/server/api/handler";

// 管理者向けの回答 CSV ダウンロード（Hono の
// eventsRoutes.get("/:id/admin/export.csv")）。
// App Router は route.ts があるパスしか公開しないため、このファイルが無いと
// 管理画面のダウンロードボタンが Next の 404 になる。
export const GET = handleApiRequest;
