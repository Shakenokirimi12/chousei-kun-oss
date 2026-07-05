import type { InferSelectModel } from "drizzle-orm";
import type { users, events, participants, availabilities, googleOauthSessions, officeHours, officeHourBookings, officeHourHostBusy } from "@/server/db/schema";

export type User = InferSelectModel<typeof users>;
export type Event = InferSelectModel<typeof events>;
export type Participant = InferSelectModel<typeof participants>;
export type Availability = InferSelectModel<typeof availabilities>;
export type GoogleOauthSession = InferSelectModel<typeof googleOauthSessions>;

export type EventWithCandidates = Omit<Event, "candidates"> & {
    candidates: string[];
};

export type EventPublicView = Pick<Event, "id" | "title" | "description" | "confirmedCandidateIdx"> & {
    candidates: string[];
};

export type ParticipantWithAvailabilities = Participant & {
    availabilities: Availability[];
};

export type AvailabilityStatus = 0 | 1 | 2;

export type CandidateStats = {
    ok: number;
    maybe: number;
    ng: number;
};

export type CandidateParticipants = {
    ok: string[];
    maybe: string[];
    ng: string[];
};

export type GoogleSessionStatus = {
    hasSession: boolean;
    email: string | null;
    hasCalendarReadScope: boolean;
    hasCalendarWriteScope: boolean;
    hasUserId: boolean;
};

export type CandidateWindow =
    | {
          allDay?: false;
          startDateTime: string;
          endDateTime: string;
      }
    | {
          allDay: true;
          /** YYYY-MM-DD */
          startDate: string;
          /** YYYY-MM-DD（排他的: 当日の翌日） */
          endDateExclusive: string;
      };

// --- Office Hour ---
export type OfficeHour = InferSelectModel<typeof officeHours>;
export type OfficeHourBooking = InferSelectModel<typeof officeHourBookings>;
export type OfficeHourHostBusy = InferSelectModel<typeof officeHourHostBusy>;
