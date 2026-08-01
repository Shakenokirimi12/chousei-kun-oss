import { handleApiRequest } from "@/server/api/handler";

// 作成者（端末の userId）ごとのイベント一覧（Hono の
// eventsRoutes.get("/by-creator/:userId")）。
// App Router は route.ts があるパスしか公開しないため、このファイルが無いと
// /me のイベント一覧やモバイルアプリのホームが Next の 404 になる。
export const GET = handleApiRequest;
