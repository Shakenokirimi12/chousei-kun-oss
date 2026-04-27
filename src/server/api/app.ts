import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { CampusSquareService } from "@/lib/campus-square";
import { createPasswordHash, verifyPassword } from "@/lib/admin-auth";
import { createDb } from "@/server/db/client";
import { availabilities, events, googleOauthSessions, participants } from "@/server/db/schema";
import { CUSTOM_PERIODS } from "@/config/periods";

type Bindings = {
    DB: D1Database;
};

const createEventSchema = z.object({
    title: z.string().trim().min(1),
    description: z.string().optional().default(""),
    candidates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}_(P|H)\d+$/)).min(1),
    adminPassword: z.string().min(6),
});

const eventIdParamSchema = z.object({
    id: z.string().uuid(),
});

const participateSchema = z.object({
    name: z.string().trim().min(1),
    comment: z.string().optional().default(""),
    availabilities: z.array(z.number().int().min(0).max(2)),
    participantId: z.string().uuid().optional(),
    notifyOnFinalize: z.boolean().optional().default(false),
    notificationEmail: z.string().email().optional().or(z.literal("")).default(""),
});

const adminAuthSchema = z.object({
    password: z.string().min(1),
});

const adminUpdateSchema = z.object({
    title: z.string().trim().min(1),
    description: z.string().optional().default(""),
    candidates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}_(P|H)\d+$/)).min(1),
});

const confirmCandidateSchema = z.object({
    confirmedCandidateIdx: z.number().int().min(0).nullable(),
});

const syncCalendarSchema = z.object({
    uid: z.string().min(1),
    pass: z.string().min(1),
});
const googleStartQuerySchema = z.object({
    returnTo: z.string().optional().default("/"),
});

const GOOGLE_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
].join(" ");
const GOOGLE_CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function getEnvOrThrow(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
}

function encodeState(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeState<T>(state: string): T {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as T;
}

function parseCookieValue(cookieHeader: string, key: string): string | undefined {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
    return match?.[1];
}

function cookieSecurityAttr(requestUrl: string): string {
    const isHttps = requestUrl.startsWith("https://");
    return isHttps ? "; Secure" : "";
}

function formatJstDateTime(datePart: string, hhmm: string): string {
    const [hourRaw, minuteRaw] = hhmm.split(":");
    const hour = String(Number(hourRaw)).padStart(2, "0");
    const minute = String(Number(minuteRaw)).padStart(2, "0");
    return `${datePart}T${hour}:${minute}:00+09:00`;
}

function parseCandidateWindow(candidate: string): {
    startDateTime: string;
    endDateTime: string;
} | null {
    const [datePart, slotRaw] = candidate.split("_");
    if (!datePart || !slotRaw) return null;

    const slotType = slotRaw.charAt(0);
    const slotId = Number.parseInt(slotRaw.slice(1), 10);
    if (Number.isNaN(slotId)) return null;

    if (slotType === "P") {
        const period = CUSTOM_PERIODS.find((p) => p.id === slotId);
        if (!period) return null;
        const [startHm, endHm] = period.time.split("-");
        return {
            startDateTime: formatJstDateTime(datePart, startHm),
            endDateTime: formatJstDateTime(datePart, endHm),
        };
    }

    if (slotType === "H") {
        const startHour = Math.max(0, Math.min(23, slotId));
        const endHour = Math.min(24, startHour + 1);
        const startHm = `${String(startHour).padStart(2, "0")}:00`;
        const endHm = `${String(endHour).padStart(2, "0")}:00`;
        return {
            startDateTime: formatJstDateTime(datePart, startHm),
            endDateTime: formatJstDateTime(datePart, endHm),
        };
    }

    return null;
}

async function refreshGoogleTokenIfNeeded(db: ReturnType<typeof createDb>, sessionId: string) {
    const record = await db.query.googleOauthSessions.findFirst({
        where: eq(googleOauthSessions.sessionId, sessionId),
    });
    if (!record) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (record.expiresAt > nowSec + 60) return record;
    if (!record.refreshToken) return record;

    const clientId = getEnvOrThrow("GOOGLE_CLIENT_ID");
    const clientSecret = getEnvOrThrow("GOOGLE_CLIENT_SECRET");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: record.refreshToken,
        }),
    });
    if (!tokenRes.ok) return record;
    const tokenJson = await tokenRes.json() as { access_token: string; expires_in: number };
    const updatedExpiresAt = Math.floor(Date.now() / 1000) + tokenJson.expires_in;
    await db
        .update(googleOauthSessions)
        .set({
            accessToken: tokenJson.access_token,
            expiresAt: updatedExpiresAt,
            updatedAt: Date.now(),
        })
        .where(eq(googleOauthSessions.sessionId, sessionId));

    return await db.query.googleOauthSessions.findFirst({
        where: eq(googleOauthSessions.sessionId, sessionId),
    });
}

async function getGoogleSessionAndScopes(db: ReturnType<typeof createDb>, sessionId: string) {
    const session = await refreshGoogleTokenIfNeeded(db, sessionId);
    if (!session) {
        return { session: null, scopes: [] as string[] };
    }

    const tokenInfoRes = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(session.accessToken)}`
    );
    if (!tokenInfoRes.ok) {
        return { session, scopes: [] as string[] };
    }

    const tokenInfo = await tokenInfoRes.json() as { scope?: string };
    const scopes = tokenInfo.scope?.split(" ").filter(Boolean) ?? [];
    return { session, scopes };
}

export const apiApp = new Hono<{ Bindings: Bindings }>().basePath("/api");

apiApp.post("/events", sValidator("json", createEventSchema), async (c) => {
    const db = createDb(c.env.DB);
    const { title, description, candidates, adminPassword } = c.req.valid("json");
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const adminPasswordHash = await createPasswordHash(adminPassword);
    const adminAccessToken = crypto.randomUUID();

    await db.insert(events).values({
        id,
        title,
        description: description || null,
        candidates: JSON.stringify(candidates),
        createdAt,
        adminPasswordHash,
        adminAccessToken,
    });

    return c.json({ id }, 201);
});

apiApp.get("/events/:id", sValidator("param", eventIdParamSchema), async (c) => {
    const db = createDb(c.env.DB);
    const { id } = c.req.valid("param");

    const event = await db.query.events.findFirst({
        where: eq(events.id, id),
        columns: {
            id: true,
            title: true,
            description: true,
            candidates: true,
            confirmedCandidateIdx: true,
        },
    });

    if (!event) return c.json({ error: "Event not found" }, 404);

    const participantRows = await db.query.participants.findMany({
        where: eq(participants.eventId, id),
    });

    const availabilityRows = await db
        .select({
            id: availabilities.id,
            participantId: availabilities.participantId,
            candidateIdx: availabilities.candidateIdx,
            status: availabilities.status,
        })
        .from(availabilities)
        .innerJoin(participants, eq(availabilities.participantId, participants.id))
        .where(eq(participants.eventId, id));

    return c.json({
        event: {
            ...event,
            candidates: JSON.parse(event.candidates),
        },
        participants: participantRows,
        availabilities: availabilityRows,
    });
});

apiApp.post(
    "/events/:id/participate",
    sValidator("param", eventIdParamSchema),
    sValidator("json", participateSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id: eventId } = c.req.valid("param");
        const { name, comment, availabilities: statuses, participantId, notifyOnFinalize, notificationEmail } = c.req.valid("json");
        const cookieHeader = c.req.header("cookie") ?? "";
        const googleSessionId = parseCookieValue(cookieHeader, "chousei_google_session");
        const googleSession = googleSessionId ? await refreshGoogleTokenIfNeeded(db, googleSessionId) : null;

        const normalizedComment = comment || null;
        const normalizedNotificationEmail = notificationEmail?.trim() ? notificationEmail.trim() : (googleSession?.email ?? null);
        const effectiveNotifyOnFinalize = notifyOnFinalize || !!googleSession?.email;
        if (effectiveNotifyOnFinalize && !normalizedNotificationEmail) {
            return c.json({ error: "通知を受け取る場合はメールアドレスが必要です" }, 400);
        }
        const newParticipantId = participantId ?? crypto.randomUUID();

        if (participantId) {
            await db
                .update(participants)
                .set({
                    name,
                    comment: normalizedComment,
                    notifyOnFinalize: effectiveNotifyOnFinalize ? 1 : 0,
                    notificationEmail: normalizedNotificationEmail,
                })
                .where(eq(participants.id, participantId));
            await db.delete(availabilities).where(eq(availabilities.participantId, participantId));
        } else {
            await db.insert(participants).values({
                id: newParticipantId,
                eventId,
                name,
                comment: normalizedComment,
                notifyOnFinalize: effectiveNotifyOnFinalize ? 1 : 0,
                notificationEmail: normalizedNotificationEmail,
            });
        }

        if (statuses.length > 0) {
            await db.insert(availabilities).values(
                statuses.map((status, idx) => ({
                    id: crypto.randomUUID(),
                    participantId: newParticipantId,
                    candidateIdx: idx,
                    status,
                }))
            );
        }

        return c.json({ success: true, participantId: newParticipantId });
    }
);

apiApp.post(
    "/events/:id/admin-auth",
    sValidator("param", eventIdParamSchema),
    sValidator("json", adminAuthSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const { password } = c.req.valid("json");

        const event = await db.query.events.findFirst({
            where: eq(events.id, id),
            columns: {
                adminPasswordHash: true,
                adminAccessToken: true,
            },
        });
        if (!event) return c.json({ error: "Event not found" }, 404);

        const ok = await verifyPassword(password, event.adminPasswordHash);
        if (!ok || !event.adminAccessToken) return c.json({ error: "Invalid password" }, 401);

        c.header(
            "Set-Cookie",
            `chousei_admin_${id}=${event.adminAccessToken}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`
        );
        return c.json({ ok: true });
    }
);

apiApp.post(
    "/events/:id/admin-logout",
    sValidator("param", eventIdParamSchema),
    async (c) => {
        const { id } = c.req.valid("param");
        c.header(
            "Set-Cookie",
            `chousei_admin_${id}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`
        );
        return c.json({ ok: true });
    }
);

apiApp.patch(
    "/events/:id/admin",
    sValidator("param", eventIdParamSchema),
    sValidator("json", adminUpdateSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const { title, description, candidates: nextCandidates } = c.req.valid("json");

        const cookie = c.req.header("cookie") ?? "";
        const tokenMatch = cookie.match(new RegExp(`(?:^|;\\s*)chousei_admin_${id}=([^;]+)`));
        const sessionToken = tokenMatch?.[1];

        const currentEvent = await db.query.events.findFirst({
            where: eq(events.id, id),
            columns: {
                id: true,
                candidates: true,
                adminAccessToken: true,
            },
        });

        if (!currentEvent) return c.json({ error: "Event not found" }, 404);
        if (!currentEvent.adminAccessToken || !sessionToken || sessionToken !== currentEvent.adminAccessToken) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const oldCandidates = JSON.parse(currentEvent.candidates) as string[];
        const indexMap = new Map<string, number>();
        nextCandidates.forEach((candidate, idx) => {
            indexMap.set(candidate, idx);
        });

        const availabilityRows = await c.env.DB.prepare(
            `SELECT a.id, a.participant_id, a.candidate_idx, a.status
             FROM availabilities a
             JOIN participants p ON p.id = a.participant_id
             WHERE p.event_id = ?`
        ).bind(id).all<{ id: string; participant_id: string; candidate_idx: number; status: number }>();

        await c.env.DB.prepare(
            `DELETE FROM availabilities
             WHERE participant_id IN (SELECT id FROM participants WHERE event_id = ?)`
        ).bind(id).run();

        const remappedValues: Array<{ id: string; participantId: string; candidateIdx: number; status: number }> = [];
        for (const row of availabilityRows.results) {
            const oldCandidate = oldCandidates[row.candidate_idx];
            if (!oldCandidate) continue;
            const newIdx = indexMap.get(oldCandidate);
            if (newIdx === undefined) continue;
            remappedValues.push({
                id: crypto.randomUUID(),
                participantId: row.participant_id,
                candidateIdx: newIdx,
                status: row.status,
            });
        }
        if (remappedValues.length > 0) {
            await db.insert(availabilities).values(remappedValues);
        }

        await db
            .update(events)
            .set({
                title,
                description: description || null,
                candidates: JSON.stringify(nextCandidates),
            })
            .where(eq(events.id, id));

        return c.json({ ok: true });
    }
);

apiApp.post(
    "/events/:id/admin/confirm",
    sValidator("param", eventIdParamSchema),
    sValidator("json", confirmCandidateSchema),
    async (c) => {
        const db = createDb(c.env.DB);
        const { id } = c.req.valid("param");
        const { confirmedCandidateIdx } = c.req.valid("json");

        const cookie = c.req.header("cookie") ?? "";
        const tokenMatch = cookie.match(new RegExp(`(?:^|;\\s*)chousei_admin_${id}=([^;]+)`));
        const sessionToken = tokenMatch?.[1];

        const currentEvent = await db.query.events.findFirst({
            where: eq(events.id, id),
            columns: {
                candidates: true,
                adminAccessToken: true,
                title: true,
                description: true,
            },
        });
        if (!currentEvent) return c.json({ error: "Event not found" }, 404);
        if (!currentEvent.adminAccessToken || !sessionToken || sessionToken !== currentEvent.adminAccessToken) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const candidates = JSON.parse(currentEvent.candidates) as string[];
        if (confirmedCandidateIdx !== null && confirmedCandidateIdx >= candidates.length) {
            return c.json({ error: "Invalid confirmed candidate index" }, 400);
        }

        await db
            .update(events)
            .set({ confirmedCandidateIdx })
            .where(eq(events.id, id));

        const recipients = await db.query.participants.findMany({
            where: eq(participants.eventId, id),
            columns: {
                name: true,
                notifyOnFinalize: true,
                notificationEmail: true,
            },
        });
        const inviteTargets = recipients
            .filter((p) => p.notifyOnFinalize === 1 && !!p.notificationEmail)
            .map((p) => ({ name: p.name, email: p.notificationEmail as string }));

        if (confirmedCandidateIdx !== null && inviteTargets.length > 0) {
            const googleSessionId = parseCookieValue(cookie, "chousei_google_session");
            if (!googleSessionId) {
                return c.json({ ok: true, warning: "Google session not found for invite sender" });
            }
            const googleSession = await refreshGoogleTokenIfNeeded(db, googleSessionId);
            if (!googleSession) {
                return c.json({ ok: true, warning: "Google session not found for invite sender" });
            }

            const selectedCandidate = candidates[confirmedCandidateIdx];
            const candidateWindow = selectedCandidate ? parseCandidateWindow(selectedCandidate) : null;
            if (!candidateWindow) {
                return c.json({ ok: true, warning: "Failed to parse confirmed schedule window" });
            }

            const dedupedAttendees = Array.from(
                new Map(inviteTargets.map((target) => [target.email, target])).values()
            );
            const insertRes = await fetch(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${googleSession.accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        summary: `${currentEvent.title}（確定）`,
                        description: currentEvent.description ?? "調整くんで確定した日程です。",
                        start: {
                            dateTime: candidateWindow.startDateTime,
                            timeZone: "Asia/Tokyo",
                        },
                        end: {
                            dateTime: candidateWindow.endDateTime,
                            timeZone: "Asia/Tokyo",
                        },
                        attendees: dedupedAttendees.map((target) => ({
                            email: target.email,
                            displayName: target.name,
                        })),
                    }),
                }
            );
            if (!insertRes.ok) {
                const errText = await insertRes.text();
                console.error("[GoogleInvite:error]", errText);
                return c.json({ ok: true, warning: "Failed to send Google Calendar invites" });
            }
        }

        return c.json({ ok: true });
    }
);

apiApp.post("/sync-calendar", sValidator("json", syncCalendarSchema), async (c) => {
    if (process.env.NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE !== "true") {
        return c.json({ error: "Campus Square integration is disabled." }, 404);
    }

    const { uid, pass } = c.req.valid("json");
    const syncedEvents = await CampusSquareService.fetchCalendarEvents(uid, pass);
    return c.json({ events: syncedEvents });
});

apiApp.get("/google/auth/start", sValidator("query", googleStartQuerySchema), async (c) => {
    const clientId = getEnvOrThrow("GOOGLE_CLIENT_ID");
    const redirectUri = getEnvOrThrow("GOOGLE_REDIRECT_URI");
    const { returnTo } = c.req.valid("query");
    const nonce = crypto.randomUUID();
    const state = encodeState({ nonce, returnTo });

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GOOGLE_SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    const secureAttr = cookieSecurityAttr(c.req.url);
    c.header("Set-Cookie", `chousei_google_oauth_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=600`);
    return c.redirect(authUrl.toString(), 302);
});

apiApp.get("/google/auth/callback", async (c) => {
    const clientId = getEnvOrThrow("GOOGLE_CLIENT_ID");
    const clientSecret = getEnvOrThrow("GOOGLE_CLIENT_SECRET");
    const redirectUri = getEnvOrThrow("GOOGLE_REDIRECT_URI");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.json({ error: "Invalid OAuth callback" }, 400);

    const cookieHeader = c.req.header("cookie") ?? "";
    const nonceFromCookie = parseCookieValue(cookieHeader, "chousei_google_oauth_nonce");
    const decoded = decodeState<{ nonce: string; returnTo?: string }>(state);
    if (!nonceFromCookie || decoded.nonce !== nonceFromCookie) {
        return c.json({ error: "Invalid OAuth state" }, 400);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
        }),
    });
    if (!tokenRes.ok) return c.json({ error: "Failed to exchange token" }, 500);
    const tokenJson = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        id_token?: string;
    };

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userInfoRes.ok) return c.json({ error: "Failed to fetch user info" }, 500);
    const userInfo = await userInfoRes.json() as { email: string };

    const db = createDb(c.env.DB);
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = Math.floor(now / 1000) + tokenJson.expires_in;
    await db.insert(googleOauthSessions).values({
        sessionId,
        email: userInfo.email,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
    });

    const redirectTo =
        decoded.returnTo && decoded.returnTo.startsWith("/") ? decoded.returnTo : "/";
    const secureAttr = cookieSecurityAttr(c.req.url);
    c.header(
        "Set-Cookie",
        `chousei_google_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=2592000`,
        { append: true }
    );
    c.header(
        "Set-Cookie",
        `chousei_google_oauth_nonce=; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=0`,
        { append: true }
    );
    return c.redirect(redirectTo, 302);
});

apiApp.get("/google/calendar/events", async (c) => {
    const cookieHeader = c.req.header("cookie") ?? "";
    const sessionId = parseCookieValue(cookieHeader, "chousei_google_session");
    if (!sessionId) return c.json({ error: "Google session not found" }, 401);

    const db = createDb(c.env.DB);
    const session = await refreshGoogleTokenIfNeeded(db, sessionId);
    if (!session) return c.json({ error: "Google session not found" }, 401);

    const calendarListRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!calendarListRes.ok) return c.json({ error: "Failed to fetch calendar list" }, 500);
    const calendarList = await calendarListRes.json() as { items?: Array<{ id: string }> };
    const calendarIds = (calendarList.items ?? []).map((cItem) => cItem.id).slice(0, 10);

    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 1000 * 60 * 60 * 24 * 120).toISOString();
    const events: Array<Record<string, unknown>> = [];
    for (const calendarId of calendarIds) {
        const evRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250`,
            { headers: { Authorization: `Bearer ${session.accessToken}` } }
        );
        if (!evRes.ok) continue;
        const evJson = await evRes.json() as {
            items?: Array<{
                summary?: string;
                description?: string;
                htmlLink?: string;
                start?: { dateTime?: string; date?: string };
                end?: { dateTime?: string; date?: string };
                source?: { url?: string };
            }>;
        };
        for (const item of evJson.items ?? []) {
            events.push({
                summary: item.summary ?? "",
                description: item.description ?? "",
                htmlLink: item.htmlLink ?? "",
                calendarId,
                sourceUrl: item.source?.url ?? "",
                dtstart: item.start?.dateTime ?? item.start?.date ?? "",
                dtend: item.end?.dateTime ?? item.end?.date ?? "",
                allDay: !!item.start?.date && !item.start?.dateTime,
            });
        }
    }

    return c.json({ email: session.email, events });
});

apiApp.get("/google/session-status", async (c) => {
    const cookieHeader = c.req.header("cookie") ?? "";
    const sessionId = parseCookieValue(cookieHeader, "chousei_google_session");
    if (!sessionId) {
        return c.json({
            hasSession: false,
            email: null,
            hasCalendarReadScope: false,
            hasCalendarWriteScope: false,
        });
    }

    const db = createDb(c.env.DB);
    const { session, scopes } = await getGoogleSessionAndScopes(db, sessionId);
    if (!session) {
        return c.json({
            hasSession: false,
            email: null,
            hasCalendarReadScope: false,
            hasCalendarWriteScope: false,
        });
    }

    return c.json({
        hasSession: true,
        email: session.email,
        hasCalendarReadScope: scopes.includes(GOOGLE_CALENDAR_READ_SCOPE),
        hasCalendarWriteScope: scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE),
    });
});

apiApp.post("/google/logout", async (c) => {
    const cookieHeader = c.req.header("cookie") ?? "";
    const sessionId = parseCookieValue(cookieHeader, "chousei_google_session");
    if (sessionId) {
        const db = createDb(c.env.DB);
        await db.delete(googleOauthSessions).where(eq(googleOauthSessions.sessionId, sessionId));
    }
    const secureAttr = cookieSecurityAttr(c.req.url);
    c.header("Set-Cookie", `chousei_google_session=; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=0`);
    return c.json({ ok: true });
});

apiApp.onError((error, c) => {
    console.error("[API Error]", error);
    return c.json({ error: error.message || "Internal Server Error" }, 500);
});
