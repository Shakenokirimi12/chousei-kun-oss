import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * ユーザーテーブル
 * 端末固有の識別子とカレンダー購読トークンを管理
 */
export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    calendarToken: text("calendar_token").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
});

/**
 * イベントテーブル
 * 日程調整イベントの基本情報
 */
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

/**
 * 参加者テーブル
 * イベントへの参加者情報と通知設定
 */
export const participants = sqliteTable("participants", {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    userId: text("user_id"),
    name: text("name").notNull(),
    comment: text("comment"),
    notifyOnFinalize: integer("notify_on_finalize").notNull().default(0),
    notificationEmail: text("notification_email"),
});

/**
 * 回答テーブル
 * 各参加者の候補日時に対する回答
 */
export const availabilities = sqliteTable("availabilities", {
    id: text("id").primaryKey(),
    participantId: text("participant_id").notNull(),
    candidateIdx: integer("candidate_idx").notNull(),
    status: integer("status").notNull(),
});

/**
 * Office Hour（Time Slot 予約）スケジュール本体
 * 主催者はGoogle + 大学カレンダー連携が必須。Cron で busy を同期する。
 */
export const officeHours = sqliteTable("office_hours", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    startDate: integer("start_date"),           // NULL = 「今日から」
    endDate: integer("end_date"),               // NULL = 「無期限」
    windows: text("windows").notNull(),                 // JSON
    slotDurationMin: integer("slot_duration_min").notNull(),
    capacityPerSlot: integer("capacity_per_slot").notNull().default(1),
    bufferMin: integer("buffer_min").notNull().default(0),
    adminPasswordHash: text("admin_password_hash").notNull(),
    adminAccessToken: text("admin_access_token").notNull(),
    hostUserId: text("host_user_id").notNull(),
    hostGoogleSessionId: text("host_google_session_id").notNull(),
    // 大学カレンダーは iCal URL を直接保管（認証情報は持たない）。
    // URL 自体が長期的なクレデンシャルなので AES-GCM で暗号化保存する。
    hostIcalUrl: text("host_ical_url").notNull(),
    lastSyncAt: integer("last_sync_at"),
    lastSyncError: text("last_sync_error"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
});

/**
 * Office Hour の予約レコード（1枠複数人可）
 */
export const officeHourBookings = sqliteTable("office_hour_bookings", {
    id: text("id").primaryKey(),
    officeHourId: text("office_hour_id").notNull(),
    slotStart: integer("slot_start").notNull(),
    name: text("name").notNull(),
    comment: text("comment"),
    email: text("email"),
    userId: text("user_id"),
    googleCalendarEventId: text("google_calendar_event_id"),
    createdAt: integer("created_at").notNull(),
});

/**
 * 主催者の busy 予定キャッシュ（Cron が洗い替え）
 */
export const officeHourHostBusy = sqliteTable("office_hour_host_busy", {
    id: text("id").primaryKey(),
    officeHourId: text("office_hour_id").notNull(),
    source: text("source").notNull(),                   // 'google' | 'campus'
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    summary: text("summary"),
    fetchedAt: integer("fetched_at").notNull(),
});

/**
 * Google OAuth セッションテーブル
 * Googleアカウント連携情報
 */
export const googleOauthSessions = sqliteTable("google_oauth_sessions", {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id"),
    email: text("email").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
});
