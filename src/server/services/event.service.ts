import { eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import { events, participants, availabilities } from "@/server/db/schema";
import type { Event, Participant, Availability, EventPublicView } from "@/types";
import { decryptPii } from "@/lib/pii-crypto";

export class EventService {
    constructor(private db: DbClient) {}

    async findById(id: string): Promise<Event | null> {
        const event = await this.db.query.events.findFirst({
            where: eq(events.id, id),
        });
        return event ?? null;
    }

    async findByIdPublic(id: string): Promise<EventPublicView | null> {
        const event = await this.db.query.events.findFirst({
            where: eq(events.id, id),
            columns: {
                id: true,
                title: true,
                description: true,
                candidates: true,
                confirmedCandidateIdx: true,
            },
        });
        if (!event) return null;

        return {
            ...event,
            candidates: JSON.parse(event.candidates) as string[],
        };
    }

    async findByIdWithAuth(id: string): Promise<Pick<Event, "id" | "candidates" | "adminAccessToken"> | null> {
        const event = await this.db.query.events.findFirst({
            where: eq(events.id, id),
            columns: {
                id: true,
                candidates: true,
                adminAccessToken: true,
            },
        });
        return event ?? null;
    }

    async findByIdForAdmin(id: string): Promise<(Omit<Event, "candidates"> & { candidates: string[] }) | null> {
        const event = await this.db.query.events.findFirst({
            where: eq(events.id, id),
        });
        if (!event) return null;
        
        return {
            ...event,
            candidates: JSON.parse(event.candidates) as string[],
        };
    }

    async getParticipants(eventId: string): Promise<Participant[]> {
        const rows = await this.db.query.participants.findMany({
            where: eq(participants.eventId, eventId),
        });
        // PII (name / comment / notificationEmail) は AES-GCM で暗号化保存されているので
        // アプリ層では常に復号した値を返す。旧来の平文行はそのまま透過される。
        return Promise.all(
            rows.map(async (p) => ({
                ...p,
                name: (await decryptPii(p.name)) ?? "",
                comment: await decryptPii(p.comment),
                notificationEmail: await decryptPii(p.notificationEmail),
            }))
        );
    }

    /**
     * 公開ページ向けの参加者一覧。通知メール等のPIIを除外し、表示に必要な列のみ返す。
     * 名前・コメントは保存時暗号化されているので復号して返す。
     */
    async getParticipantsPublic(eventId: string): Promise<Pick<Participant, "id" | "name" | "comment">[]> {
        const rows = await this.db
            .select({
                id: participants.id,
                name: participants.name,
                comment: participants.comment,
            })
            .from(participants)
            .where(eq(participants.eventId, eventId));
        return Promise.all(
            rows.map(async (p) => ({
                id: p.id,
                name: (await decryptPii(p.name)) ?? "",
                comment: await decryptPii(p.comment),
            }))
        );
    }

    async getAvailabilities(eventId: string): Promise<Availability[]> {
        return this.db
            .select({
                participantId: availabilities.participantId,
                candidateIdx: availabilities.candidateIdx,
                status: availabilities.status,
            })
            .from(availabilities)
            .innerJoin(participants, eq(availabilities.participantId, participants.id))
            .where(eq(participants.eventId, eventId));
    }

    async getEventWithParticipantsAndAvailabilities(eventId: string) {
        const [event, participantList, availabilityList] = await Promise.all([
            this.findByIdPublic(eventId),
            this.getParticipantsPublic(eventId),
            this.getAvailabilities(eventId),
        ]);

        return { event, participants: participantList, availabilities: availabilityList };
    }
}

export function createEventService(db: DbClient): EventService {
    return new EventService(db);
}
