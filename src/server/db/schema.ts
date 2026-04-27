import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    candidates: text("candidates").notNull(),
    createdAt: integer("created_at").notNull(),
    adminPasswordHash: text("admin_password_hash"),
    adminAccessToken: text("admin_access_token"),
    confirmedCandidateIdx: integer("confirmed_candidate_idx"),
});

export const participants = sqliteTable("participants", {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    comment: text("comment"),
    notifyOnFinalize: integer("notify_on_finalize").notNull().default(0),
    notificationEmail: text("notification_email"),
});

export const availabilities = sqliteTable("availabilities", {
    id: text("id").primaryKey(),
    participantId: text("participant_id").notNull(),
    candidateIdx: integer("candidate_idx").notNull(),
    status: integer("status").notNull(),
});

export const googleOauthSessions = sqliteTable("google_oauth_sessions", {
    sessionId: text("session_id").primaryKey(),
    email: text("email").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
});
