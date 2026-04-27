import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { CampusSquareService } from "@/lib/campus-square";
import { createPasswordHash, verifyPassword } from "@/lib/admin-auth";
import { createDb } from "@/server/db/client";
import { availabilities, events, participants } from "@/server/db/schema";

type Bindings = {
    DB: D1Database;
};

const createEventSchema = z.object({
    title: z.string().trim().min(1),
    description: z.string().optional().default(""),
    candidates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}_P\d+$/)).min(1),
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
});

const adminAuthSchema = z.object({
    password: z.string().min(1),
});

const adminUpdateSchema = z.object({
    title: z.string().trim().min(1),
    description: z.string().optional().default(""),
    candidates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}_P\d+$/)).min(1),
    confirmedCandidateIdx: z.number().int().min(0).nullable(),
});

const syncCalendarSchema = z.object({
    uid: z.string().min(1),
    pass: z.string().min(1),
});

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
        const { name, comment, availabilities: statuses, participantId } = c.req.valid("json");

        const normalizedComment = comment || null;
        const newParticipantId = participantId ?? crypto.randomUUID();

        if (participantId) {
            await db
                .update(participants)
                .set({ name, comment: normalizedComment })
                .where(eq(participants.id, participantId));
            await db.delete(availabilities).where(eq(availabilities.participantId, participantId));
        } else {
            await db.insert(participants).values({
                id: newParticipantId,
                eventId,
                name,
                comment: normalizedComment,
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
            `chousei_admin_${id}=${event.adminAccessToken}; Path=/${id}/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`
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
        const { title, description, candidates: nextCandidates, confirmedCandidateIdx } = c.req.valid("json");

        if (confirmedCandidateIdx !== null && confirmedCandidateIdx >= nextCandidates.length) {
            return c.json({ error: "Invalid confirmed candidate index" }, 400);
        }

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
                confirmedCandidateIdx,
            })
            .where(eq(events.id, id));

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

apiApp.onError((error, c) => {
    console.error("[API Error]", error);
    return c.json({ error: error.message || "Internal Server Error" }, 500);
});
