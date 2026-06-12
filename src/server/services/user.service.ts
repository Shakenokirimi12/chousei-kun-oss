import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import { users, participants, events, googleOauthSessions } from "@/server/db/schema";
import type { User } from "@/types";

export class UserService {
    constructor(private db: DbClient) {}

    async findById(id: string): Promise<User | null> {
        const result = await this.db
            .select()
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
        return result[0] ?? null;
    }

    async findByCalendarToken(calendarToken: string): Promise<User | null> {
        const result = await this.db
            .select()
            .from(users)
            .where(eq(users.calendarToken, calendarToken))
            .limit(1);
        return result[0] ?? null;
    }

    async create(id: string, calendarToken: string): Promise<User> {
        const now = Date.now();
        await this.db.insert(users).values({
            id,
            calendarToken,
            createdAt: now,
            updatedAt: now,
        });
        return {
            id,
            calendarToken,
            createdAt: now,
            updatedAt: now,
        };
    }

    async getOrCreate(id: string): Promise<User> {
        const existing = await this.findById(id);
        if (existing) return existing;

        const calendarToken = crypto.randomUUID();
        return this.create(id, calendarToken);
    }

    async regenerateCalendarToken(userId: string): Promise<string> {
        const newToken = crypto.randomUUID();
        const now = Date.now();
        await this.db
            .update(users)
            .set({ calendarToken: newToken, updatedAt: now })
            .where(eq(users.id, userId));
        return newToken;
    }

    async getConfirmedEventsForUser(userId: string) {
        const userParticipants = await this.db
            .select({
                participantId: participants.id,
                eventId: participants.eventId,
                participantName: participants.name,
            })
            .from(participants)
            .where(eq(participants.userId, userId));

        if (userParticipants.length === 0) return [];

        const eventIds = [...new Set(userParticipants.map((p) => p.eventId))];

        const confirmedEvents = await this.db
            .select({
                id: events.id,
                title: events.title,
                description: events.description,
                candidates: events.candidates,
                confirmedCandidateIdx: events.confirmedCandidateIdx,
            })
            .from(events)
            .where(
                and(
                    inArray(events.id, eventIds),
                    isNotNull(events.confirmedCandidateIdx)
                )
            );

        return confirmedEvents.map((e) => ({
            ...e,
            candidates: JSON.parse(e.candidates) as string[],
        }));
    }

    async linkParticipantToUser(participantId: string, userId: string): Promise<void> {
        await this.db
            .update(participants)
            .set({ userId })
            .where(eq(participants.id, participantId));
    }

    async linkGoogleSessionToUser(sessionId: string, userId: string): Promise<void> {
        await this.db
            .update(googleOauthSessions)
            .set({ userId })
            .where(eq(googleOauthSessions.sessionId, sessionId));
    }
}

export function createUserService(db: DbClient): UserService {
    return new UserService(db);
}
