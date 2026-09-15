import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createDb, type DbClient } from "@/server/db/client";
import { events, participants } from "@/server/db/schema";
import { createPasswordHash, verifyPassword } from "@/lib/admin-auth";
import { encryptPii } from "@/lib/pii-crypto";
import { isAllDayEvent } from "@/lib/candidates";
import { safeJsonParse } from "@/lib/safe-json";
import { siteConfig } from "@/config/site";
import { createEventSchema, participateSchema, confirmCandidateSchema } from "@/server/api/schemas";
import { replaceAvailabilities } from "@/server/api/routes/events";
import type { EventService } from "@/server/services/event.service";
import { createEventService, createUserService } from "@/server/services";
import { enforceRateLimit, type RateLimitBinding } from "@/server/api/rate-limit";

function eventUrl(id: string): string {
    return `${siteConfig.url}/${id}`;
}

function errorResult(text: string) {
    return { content: [{ type: "text" as const, text }], isError: true as const };
}

function jsonResult(data: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const TOO_MANY_ATTEMPTS = "試行回数が多すぎます。しばらくしてから再度お試しください。";

/** worker.ts が ctx.props 経由で渡す、セッション開始時の接続元情報。 */
export type McpProps = { ip?: string };

/**
 * 管理者操作用のパスワード検証。ブラウザの admin セッション Cookie に相当するものが
 * MCP 経由の呼び出しには無いため、ツール呼び出しごとに adminPassword を直接検証する。
 *
 * HTTP の /admin-auth と同じく、イベント + IP 単位で AUTH_RATE_LIMITER を掛ける。
 * 掛けないと MCP が総当たりの抜け道になる。
 */
async function verifyAdminPassword(
    db: DbClient,
    limiter: RateLimitBinding | undefined,
    ip: string,
    eventId: string,
    password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const allowed = await enforceRateLimit(limiter, `auth:${eventId}:${ip}`);
    if (!allowed) return { ok: false, error: TOO_MANY_ATTEMPTS };
    const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { adminPasswordHash: true },
    });
    if (!event) return { ok: false, error: "Event not found" };
    const result = await verifyPassword(password, event.adminPasswordHash);
    return result.ok ? { ok: true } : { ok: false, error: "Invalid password" };
}

async function getPublicParticipants(eventService: EventService, eventId: string) {
    const participants = await eventService.getParticipantsPublic(eventId);
    const availabilities = await eventService.getAvailabilities(eventId);
    return { participants, availabilities };
}

type State = Record<string, never>;

export class ChouseiMcpAgent extends McpAgent<Cloudflare.Env, State, McpProps> {
    server = new McpServer({
        name: "chousei-kun",
        version: "0.1.0",
    });

    initialState: State = {};

    private get clientIp(): string {
        return this.props?.ip ?? "unknown";
    }

    private verifyAdmin(db: DbClient, eventId: string, password: string) {
        return verifyAdminPassword(db, this.env.AUTH_RATE_LIMITER, this.clientIp, eventId, password);
    }

    async init() {
        this.server.registerTool(
            "create_event",
            {
                title: "調整くんのイベントを作成する",
                description:
                    "候補日程を指定して新しい日程調整イベントを作成する。作成した URL を参加者に共有すれば回答を集められる。",
                inputSchema: createEventSchema.shape,
            },
            async ({ title, description, candidates, adminPassword, creatorUserId }) => {
                const db = createDb(this.env.DB);
                const id = crypto.randomUUID();
                const adminPasswordHash = await createPasswordHash(adminPassword);
                const adminAccessToken = crypto.randomUUID();

                await db.insert(events).values({
                    id,
                    title,
                    description: description || null,
                    candidates: JSON.stringify(candidates),
                    createdAt: Date.now(),
                    adminPasswordHash,
                    adminAccessToken,
                    createdByUserId: creatorUserId ?? null,
                });

                return jsonResult({ id, url: eventUrl(id) });
            }
        );

        this.server.registerTool(
            "list_my_events",
            {
                title: "自分が作成したイベント一覧を取得する",
                description:
                    "creatorUserId（端末ローカルの userId）に紐づく、自分が作成したイベントの一覧を取得する。",
                inputSchema: { userId: z.string().uuid() },
            },
            async ({ userId }) => {
                const db = createDb(this.env.DB);
                const rows = await db
                    .select({
                        id: events.id,
                        title: events.title,
                        description: events.description,
                        createdAt: events.createdAt,
                        confirmedCandidateIdx: events.confirmedCandidateIdx,
                    })
                    .from(events)
                    .where(eq(events.createdByUserId, userId));

                const items = rows
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((row) => ({ ...row, url: eventUrl(row.id) }));

                return jsonResult({ items });
            }
        );

        this.server.registerTool(
            "get_event",
            {
                title: "イベントの詳細・回答状況を取得する",
                description:
                    "イベント ID からタイトル・候補日程・確定日程を取得する。回答結果（参加者ごとの出欠）は " +
                    "resultsVisibleToAll が true の場合のみ含まれる。false の場合は adminPassword を渡すと閲覧できる。",
                inputSchema: {
                    eventId: z.string().uuid(),
                    adminPassword: z.string().max(256).optional(),
                },
            },
            async ({ eventId, adminPassword }) => {
                const db = createDb(this.env.DB);
                const event = await db.query.events.findFirst({
                    where: eq(events.id, eventId),
                    columns: {
                        id: true,
                        title: true,
                        description: true,
                        candidates: true,
                        confirmedCandidateIdx: true,
                        resultsVisibleToAll: true,
                        adminPasswordHash: true,
                    },
                });
                if (!event) return errorResult("Event not found");

                let isAdmin = false;
                if (adminPassword) {
                    const auth = await this.verifyAdmin(db, eventId, adminPassword);
                    if (!auth.ok && auth.error === TOO_MANY_ATTEMPTS) return errorResult(auth.error);
                    isAdmin = auth.ok;
                }

                const base = {
                    id: event.id,
                    title: event.title,
                    description: event.description,
                    candidates: safeJsonParse<string[]>(event.candidates, "events.candidates") ?? [],
                    confirmedCandidateIdx: event.confirmedCandidateIdx,
                    url: eventUrl(event.id),
                };

                if (event.resultsVisibleToAll === 0 && !isAdmin) {
                    return jsonResult({
                        ...base,
                        resultsVisible: false,
                        note: "このイベントは回答結果が非公開に設定されています。閲覧するには正しい adminPassword を指定してください。",
                    });
                }

                const eventService = createEventService(db);
                const { participants, availabilities } = await getPublicParticipants(eventService, eventId);
                return jsonResult({ ...base, resultsVisible: true, participants, availabilities });
            }
        );

        this.server.registerTool(
            "participate_in_event",
            {
                title: "イベントに参加登録・回答する",
                description:
                    "イベントに参加者として名前と各候補日程への出欠（0=×, 1=△, 2=○）を登録する。" +
                    "participantId を指定すると既存の回答を更新する。",
                inputSchema: { eventId: z.string().uuid(), ...participateSchema.shape },
            },
            async ({ eventId, name, comment, availabilities: statuses, participantId, userId, notifyOnFinalize, notificationEmail }) => {
                const db = createDb(this.env.DB);
                const event = await db.query.events.findFirst({
                    where: eq(events.id, eventId),
                    columns: { id: true },
                });
                if (!event) return errorResult("Event not found");

                const normalizedComment = comment || null;
                const normalizedNotificationEmail = notificationEmail?.trim() ? notificationEmail.trim() : null;
                if (notifyOnFinalize && !normalizedNotificationEmail) {
                    return errorResult("通知を受け取る場合は notificationEmail が必要です");
                }

                // participants.user_id は users への外部キー。Web は事前に /api/users/register を
                // 呼ぶが MCP にはその手順が無いので、ここで同じ getOrCreate を行う。
                if (userId) {
                    await createUserService(db).getOrCreate(userId);
                }

                const newParticipantId = participantId ?? crypto.randomUUID();
                const encName = (await encryptPii(name))!;
                const encComment = await encryptPii(normalizedComment);
                const encEmail = await encryptPii(normalizedNotificationEmail);

                if (participantId) {
                    const existing = await db.query.participants.findFirst({
                        where: eq(participants.id, participantId),
                        columns: { eventId: true },
                    });
                    if (!existing || existing.eventId !== eventId) {
                        return errorResult("Participant not found");
                    }
                    await db
                        .update(participants)
                        .set({
                            name: encName,
                            comment: encComment,
                            userId: userId ?? null,
                            notifyOnFinalize: notifyOnFinalize ? 1 : 0,
                            notificationEmail: encEmail,
                        })
                        .where(eq(participants.id, participantId));
                } else {
                    await db.insert(participants).values({
                        id: newParticipantId,
                        eventId,
                        userId: userId ?? null,
                        name: encName,
                        comment: encComment,
                        notifyOnFinalize: notifyOnFinalize ? 1 : 0,
                        notificationEmail: encEmail,
                    });
                }

                await replaceAvailabilities(this.env.DB, newParticipantId, statuses);

                return jsonResult({ success: true, participantId: newParticipantId, url: eventUrl(eventId) });
            }
        );

        this.server.registerTool(
            "admin_confirm_candidate",
            {
                title: "管理者: 開催日程を確定する",
                description: "adminPassword で認証のうえ、確定する候補日程のインデックスを設定する（null で確定解除）。",
                inputSchema: {
                    eventId: z.string().uuid(),
                    adminPassword: z.string().max(256),
                    confirmedCandidateIdx: confirmCandidateSchema.shape.confirmedCandidateIdx,
                },
            },
            async ({ eventId, adminPassword, confirmedCandidateIdx }) => {
                const db = createDb(this.env.DB);
                const auth = await this.verifyAdmin(db, eventId, adminPassword);
                if (!auth.ok) return errorResult(auth.error);

                const currentEvent = await db.query.events.findFirst({
                    where: eq(events.id, eventId),
                    columns: { candidates: true },
                });
                if (!currentEvent) return errorResult("Event not found");

                const candidates = safeJsonParse<string[]>(currentEvent.candidates, "events.candidates") ?? [];
                if (confirmedCandidateIdx !== null && confirmedCandidateIdx >= candidates.length) {
                    return errorResult("Invalid confirmed candidate index");
                }

                await db.update(events).set({ confirmedCandidateIdx }).where(eq(events.id, eventId));
                return jsonResult({ ok: true });
            }
        );

        this.server.registerTool(
            "admin_duplicate_event",
            {
                title: "管理者: イベントを複製する",
                description:
                    "既存イベントを複製する（タイトル末尾に「（コピー）」が付く）。候補・説明はコピーされ、回答はコピーされない。" +
                    "管理者パスワードは元イベントと同じものがそのまま使える。",
                inputSchema: { eventId: z.string().uuid(), adminPassword: z.string().max(256) },
            },
            async ({ eventId, adminPassword }) => {
                const db = createDb(this.env.DB);
                const auth = await this.verifyAdmin(db, eventId, adminPassword);
                if (!auth.ok) return errorResult(auth.error);

                const src = await db.query.events.findFirst({
                    where: eq(events.id, eventId),
                    columns: {
                        title: true,
                        description: true,
                        candidates: true,
                        adminPasswordHash: true,
                        adminAccessToken: true,
                        createdByUserId: true,
                        resultsVisibleToAll: true,
                    },
                });
                if (!src) return errorResult("Event not found");

                const newId = crypto.randomUUID();
                await db.insert(events).values({
                    id: newId,
                    title: `${src.title}（コピー）`,
                    description: src.description,
                    candidates: src.candidates,
                    createdAt: Date.now(),
                    adminPasswordHash: src.adminPasswordHash,
                    adminAccessToken: src.adminAccessToken,
                    createdByUserId: src.createdByUserId,
                    resultsVisibleToAll: src.resultsVisibleToAll,
                });

                return jsonResult({ id: newId, url: eventUrl(newId) });
            }
        );

        this.server.registerTool(
            "admin_export_csv",
            {
                title: "管理者: 回答結果を CSV で取得する",
                description: "参加者ごとの名前・メール・コメント・各候補への回答（○/△/×）を CSV テキストとして取得する。",
                inputSchema: { eventId: z.string().uuid(), adminPassword: z.string().max(256) },
            },
            async ({ eventId, adminPassword }) => {
                const db = createDb(this.env.DB);
                const auth = await this.verifyAdmin(db, eventId, adminPassword);
                if (!auth.ok) return errorResult(auth.error);

                const event = await db.query.events.findFirst({
                    where: eq(events.id, eventId),
                    columns: { candidates: true },
                });
                if (!event) return errorResult("Event not found");
                const candidates = safeJsonParse<string[]>(event.candidates, "events.candidates") ?? [];

                const eventService = createEventService(db);
                const participants = await eventService.getParticipants(eventId);
                const availabilityList = await eventService.getAvailabilities(eventId);

                const statusMap = new Map<string, number>();
                for (const a of availabilityList) statusMap.set(`${a.participantId}:${a.candidateIdx}`, a.status);

                const symbolFor = (s: number | undefined) => {
                    if (s === 0) return "×";
                    if (s === 1) return "△";
                    if (s === 2) return "○";
                    return "-";
                };
                const escapeCsv = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

                const header = ["名前", "メール", "コメント", ...candidates.map((_, i) => `候補${i + 1}`)];
                const lines = [header.map(escapeCsv).join(",")];
                for (const p of participants) {
                    const cols = [
                        p.name,
                        p.notificationEmail ?? "",
                        p.comment ?? "",
                        ...candidates.map((_, i) => symbolFor(statusMap.get(`${p.id}:${i}`))),
                    ];
                    lines.push(cols.map(escapeCsv).join(","));
                }

                return jsonResult({ csv: lines.join("\n") });
            }
        );

        this.server.registerTool(
            "admin_update_results_visibility",
            {
                title: "管理者: 回答結果の公開範囲を設定する",
                description:
                    "回答結果（他の参加者の名前・回答内訳）を全員に公開するかどうかを設定する。" +
                    "日毎の出欠確認（終日）イベントでのみ false（非公開）にできる。",
                inputSchema: {
                    eventId: z.string().uuid(),
                    adminPassword: z.string().max(256),
                    resultsVisibleToAll: z.boolean(),
                },
            },
            async ({ eventId, adminPassword, resultsVisibleToAll }) => {
                const db = createDb(this.env.DB);
                const auth = await this.verifyAdmin(db, eventId, adminPassword);
                if (!auth.ok) return errorResult(auth.error);

                const currentEvent = await db.query.events.findFirst({
                    where: eq(events.id, eventId),
                    columns: { candidates: true },
                });
                if (!currentEvent) return errorResult("Event not found");

                const candidates = safeJsonParse<string[]>(currentEvent.candidates, "events.candidates") ?? [];
                if (!resultsVisibleToAll && !isAllDayEvent(candidates)) {
                    return errorResult("この設定は日毎の出欠確認（終日）イベントのみ変更できます");
                }

                await db
                    .update(events)
                    .set({ resultsVisibleToAll: resultsVisibleToAll ? 1 : 0 })
                    .where(eq(events.id, eventId));

                return jsonResult({ ok: true });
            }
        );
    }
}
