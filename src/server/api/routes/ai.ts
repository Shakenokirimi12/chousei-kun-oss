import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { z } from "zod";
import { parseCookieValue, refreshGoogleTokenIfNeeded } from "../utils";
import { createDb } from "@/server/db/client";
import { CampusSquareService } from "@/lib/campus-square";
import { parseICal } from "@/lib/ical";
import { safeFetchText } from "@/lib/safe-fetch";
import { CUSTOM_PERIODS } from "@/config/periods";
import { enforceRateLimit, clientIp, type RateLimitBinding } from "../rate-limit";

type Bindings = {
    DB: D1Database;
    OPENCODE_API_KEY: string;
    AI_RATE_LIMITER?: RateLimitBinding;
};

export const aiRoutes = new Hono<{ Bindings: Bindings }>();

const aiScheduleSchema = z.object({
    prompt: z.string().min(1).max(2000),
    history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000)
    })).max(20).optional().default([]),
    currentSchedule: z.array(z.string().max(64)).max(500), // selectedPeriods or candidates
    mode: z.enum(["create", "respond"]),
    candidates: z.array(z.string().max(64)).max(500).optional(), // Only for respond mode
    universityCredentials: z.object({
        uid: z.string().max(128),
        pass: z.string().max(256)
    }).optional(),
    icalUrl: z.string().url().max(2048).optional(),
    useGoogleCalendar: z.boolean().optional().default(false),
    useUniversityCalendar: z.boolean().optional().default(false),
});

aiRoutes.post("/schedule", sValidator("json", aiScheduleSchema), async (c) => {
    const { 
        prompt, 
        history,
        currentSchedule, 
        mode, 
        candidates, 
        universityCredentials, 
        icalUrl,
        useGoogleCalendar,
        useUniversityCalendar
    } = c.req.valid("json");
    
    const allowed = await enforceRateLimit(c.env.AI_RATE_LIMITER, `ai:${clientIp(c)}`);
    if (!allowed) {
        return c.json({ error: "リクエストが多すぎます。しばらくしてから再度お試しください。" }, 429);
    }

    const apiKey = c.env.OPENCODE_API_KEY || process.env.OPENCODE_API_KEY;
    if (!apiKey) {
        return c.json({ error: "AI configuration missing (API Key)" }, 500);
    }

    const cookieHeader = c.req.header("cookie") ?? "";
    const sessionId = parseCookieValue(cookieHeader, "chousei_google_session");

    // Pre-fetch contexts based on toggles (Stable alternative to SDK Tool Calling for this provider)
    let context = "";
    const toolCallsUsed: string[] = [];

    if (useGoogleCalendar && sessionId) {
        const db = createDb(c.env.DB);
        const session = await refreshGoogleTokenIfNeeded(db, sessionId);
        if (session) {
            try {
                const calendarListRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
                    headers: { Authorization: `Bearer ${session.accessToken}` },
                    signal: AbortSignal.timeout(10_000),
                });
                if (calendarListRes.ok) {
                    const calendarList = await calendarListRes.json() as any;
                    const calendarIds = (calendarList.items ?? []).map((cItem: any) => cItem.id).slice(0, 5);
                    const events: any[] = [];
                    const timeMin = new Date().toISOString();
                    const timeMax = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString();

                    for (const calendarId of calendarIds) {
                        const evRes = await fetch(
                            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=50`,
                            { headers: { Authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(10_000) }
                        );
                        if (!evRes.ok) continue;
                        const evJson = await evRes.json() as any;
                        events.push(...(evJson.items ?? []).map((i: any) => ({
                            summary: i.summary,
                            start: i.start?.dateTime || i.start?.date,
                            end: i.end?.dateTime || i.end?.date,
                        })));
                    }
                    context += `\n【Googleカレンダー予定】\n${events.slice(0, 30).map(e => `${e.start}〜${e.end}: ${e.summary}`).join("\n")}`;
                    toolCallsUsed.push("fetch_google_calendar");
                }
            } catch (e) {
                console.error("[AI:google_calendar]", e);
            }
        }
    }

    if (useUniversityCalendar && universityCredentials) {
        try {
            const events = await CampusSquareService.fetchCalendarEvents(universityCredentials.uid, universityCredentials.pass);
            context += `\n【大学の予定】\n${events.slice(0, 30).map(e => `${e.dtstart}〜${e.dtend}: ${e.summary}`).join("\n")}`;
            toolCallsUsed.push("fetch_university_calendar");
        } catch (e) {
            console.error("[AI:university_calendar]", e);
        }
    }

    if (icalUrl) {
        try {
            const data = await safeFetchText(icalUrl);
            const events = parseICal(data).slice(0, 30);
            context += `\n【外部iCal予定】\n${events.map(e => `${e.dtstart}〜${e.dtend}: ${e.summary}`).join("\n")}`;
            toolCallsUsed.push("fetch_ical_calendar");
        } catch (e) {
            console.error("[AI:ical]", e);
        }
    }

    const formatSlot = (slot: string) => {
        const [date, typeId] = slot.split("_");
        if (typeId?.startsWith("P")) {
            const pId = parseInt(typeId.substring(1));
            const p = CUSTOM_PERIODS.find(x => x.id === pId);
            return `${date} ${p?.label || typeId} (${p?.time || ""})`;
        } else if (typeId?.startsWith("H")) {
            const hId = typeId.substring(1);
            return `${date} ${hId}:00- ${hId}:59`;
        }
        return slot;
    };

    const formattedSchedule = currentSchedule.map(s => {
        if (mode === "respond") {
            const [slot, status] = s.split(":");
            const statusLabel = status === "2" ? "○" : status === "1" ? "△" : "×";
            return `${formatSlot(slot)}: ${statusLabel}`;
        }
        return formatSlot(s);
    });

    const systemPrompt = `あなたは日程調整ツール「調整くん」の優秀なアシスタントです。
ユーザーの要望（自然言語）に基づいて、候補日程の選択や出欠の入力をお手伝いします。

【重要：スピード優先・思考プロセス禁止】
思考プロセス（Reasoning/Thinking）は一切出力しないでください。
即座に指定されたJSON形式で回答を開始してください。

モード: ${mode === "create" ? "イベント作成（候補日程の選択）" : "イベント回答（出欠の入力）"}

現在の日程状況（読みやすい形式）:
${formattedSchedule.join("\n") || "未設定"}

【重要：現在UI上で選択・固定されている日程リスト】
${currentSchedule.join(", ")}

【動作ルール】
1. 上記の「現在UI上で選択・固定されている日程リスト」が、今選ばれている最新の状態です。
2. ユーザーの指示は、このリストを基準としています。
3. 日程を更新する際は、このリストに対して変更を加え、最終的な「全リスト」を \`updatedSchedule\` として返してください。
4. 新しい日付を自由に追加することも可能です。例: \`2023-05-22_P1\`

${mode === "respond" ? `回答可能な候補一覧（これらに対してstatusを設定してください）:\n${candidates?.join(", ")}` : ""}
${context}

【出力形式】
JSONオブジェクトのみを返してください。
絶対に思考テキストを含めないでください。即座にJSONを開始してください。
形式: {"updatedSchedule": ["slot1", "slot2", ...], "message": "ユーザーへの返答"}
それ以外のテキストは一切含めないでください。`;

    try {
        const response = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "deepseek-v4-flash",
                messages: [
                    { role: "system", content: systemPrompt },
                    ...history,
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" }
            }),
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("[AI API Error]", response.status, err);
            return c.json({ error: "AI service is temporarily unavailable" }, 502);
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            console.error("[AI Error] empty completion", JSON.stringify(data).slice(0, 500));
            return c.json({ error: "AI returned an empty response" }, 502);
        }

        let aiResponse: { updatedSchedule?: unknown; message?: unknown };
        try {
            aiResponse = JSON.parse(content);
        } catch {
            console.error("[AI Error] invalid JSON from model");
            return c.json({ error: "AI returned an invalid response" }, 502);
        }

        const updatedSchedule = Array.isArray(aiResponse.updatedSchedule)
            ? aiResponse.updatedSchedule.filter((s): s is string => typeof s === "string")
            : [];
        const message = typeof aiResponse.message === "string" ? aiResponse.message : "";

        return c.json({
            text: message,
            updatedSchedule,
            message,
            toolCalls: toolCallsUsed,
        });
    } catch (error) {
        console.error("[AI Error]", error);
        return c.json({ error: "AI processing failed" }, 500);
    }
});
