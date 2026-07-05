import { handleApiRequest } from "@/server/api/handler";

export const GET = handleApiRequest;
// 編集(PATCH)・削除(DELETE)。これらが無いと Next が 405 を返し、
// Office Hour の編集 UI・削除 UI（officeHoursRoutes.patch/delete）が機能しない。
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
