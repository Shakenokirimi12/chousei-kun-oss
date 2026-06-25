import { integer, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * ユーザーテーブル
 * 端末固有の識別子とカレンダー購読トークンを管理
 */
export const users = sqliteTable(
    "users",
    {
        id: text("id").primaryKey(),
        calendarToken: text("calendar_token").notNull().unique(),
        createdAt: integer("created_at").notNull(),
        updatedAt: integer("updated_at").notNull(),
    },
    (t) => [index("idx_users_calendar_token").on(t.calendarToken)]
);

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
    /** デバイス（localStorage の userId）と紐付ける作成者識別子。任意。 */
    createdByUserId: text("created_by_user_id"),
});

/**
 * 参加者テーブル
 * イベントへの参加者情報と通知設定
 */
export const participants = sqliteTable(
    "participants",
    {
        id: text("id").primaryKey(),
        eventId: text("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "cascade" }),
        userId: text("user_id").references(() => users.id),
        name: text("name").notNull(),
        comment: text("comment"),
        notifyOnFinalize: integer("notify_on_finalize").notNull().default(0),
        notificationEmail: text("notification_email"),
    },
    (t) => [
        index("idx_participants_event_id").on(t.eventId),
        index("idx_participants_user_id").on(t.userId),
    ]
);

/**
 * 回答テーブル
 * 各参加者の候補日時に対する回答。
 * 自然キー (participant_id, candidate_idx) を複合主キーとし、1 つの (参加者, 候補)
 * につき高々 1 行であることを DB レベルで保証する。
 */
export const availabilities = sqliteTable(
    "availabilities",
    {
        participantId: text("participant_id")
            .notNull()
            .references(() => participants.id, { onDelete: "cascade" }),
        candidateIdx: integer("candidate_idx").notNull(),
        status: integer("status").notNull(), // 0: X / 1: Triangle / 2: O
    },
    (t) => [primaryKey({ columns: [t.participantId, t.candidateIdx] })]
);

/**
 * Office Hour（Time Slot 予約）スケジュール本体
 * 主催者はGoogle + 大学カレンダー連携が必須。Cron で busy を同期する。
 */
export const officeHours = sqliteTable(
    "office_hours",
    {
        id: text("id").primaryKey(),
        title: text("title").notNull(),
        description: text("description"),
        startDate: integer("start_date"), // NULL = 「今日から」
        endDate: integer("end_date"), // NULL = 「無期限」
        windows: text("windows").notNull(), // JSON
        slotDurationMin: integer("slot_duration_min").notNull(),
        capacityPerSlot: integer("capacity_per_slot").notNull().default(1),
        bufferMin: integer("buffer_min").notNull().default(0),
        adminPasswordHash: text("admin_password_hash").notNull(),
        adminAccessToken: text("admin_access_token").notNull(),
        hostUserId: text("host_user_id")
            .notNull()
            .references(() => users.id),
        hostGoogleSessionId: text("host_google_session_id")
            .notNull()
            .references(() => googleOauthSessions.sessionId),
        // 大学カレンダーは iCal URL を直接保管（認証情報は持たない）。
        // URL 自体が長期的なクレデンシャルなので AES-GCM で暗号化保存する。
        hostIcalUrl: text("host_ical_url").notNull(),
        lastSyncAt: integer("last_sync_at"),
        lastSyncError: text("last_sync_error"),
        deletedAt: integer("deleted_at"),
        createdAt: integer("created_at").notNull(),
    },
    (t) => [
        index("idx_office_hours_host_user_id").on(t.hostUserId),
        index("idx_office_hours_end_date").on(t.endDate),
    ]
);

/**
 * Office Hour の予約レコード（1枠複数人可）
 */
export const officeHourBookings = sqliteTable(
    "office_hour_bookings",
    {
        id: text("id").primaryKey(),
        officeHourId: text("office_hour_id")
            .notNull()
            .references(() => officeHours.id, { onDelete: "cascade" }),
        slotStart: integer("slot_start").notNull(),
        name: text("name").notNull(),
        comment: text("comment"),
        email: text("email"),
        userId: text("user_id").references(() => users.id),
        googleCalendarEventId: text("google_calendar_event_id"),
        createdAt: integer("created_at").notNull(),
    },
    (t) => [
        index("idx_office_hour_bookings_oh_slot").on(t.officeHourId, t.slotStart),
        index("idx_office_hour_bookings_user").on(t.officeHourId, t.userId),
    ]
);

/**
 * 主催者の busy 予定キャッシュ（Cron が洗い替え）
 */
export const officeHourHostBusy = sqliteTable(
    "office_hour_host_busy",
    {
        id: text("id").primaryKey(),
        officeHourId: text("office_hour_id")
            .notNull()
            .references(() => officeHours.id, { onDelete: "cascade" }),
        source: text("source").notNull(), // 'google' | 'campus'
        startMs: integer("start_ms").notNull(),
        endMs: integer("end_ms").notNull(),
        summary: text("summary"),
        fetchedAt: integer("fetched_at").notNull(),
    },
    (t) => [index("idx_office_hour_host_busy_oh_start").on(t.officeHourId, t.startMs)]
);

/**
 * シフト調整: シフト表本体（1日単位）
 * 管理者がシフト枠を定義し、メンバーは「出られない枠(NG)」だけを申告。
 * 管理者が NG と定員を尊重して各枠へメンバーを割り当て、公開する。
 * ルートからの導線は持たず URL 直アクセスのみで到達する隠し機能。
 */
export const shiftBoards = sqliteTable(
    "shift_boards",
    {
        id: text("id").primaryKey(),
        title: text("title").notNull(),
        description: text("description"),
        /** 対象日（JST 0:00 の ms epoch）。前日準備は前日の日付の表を作るだけ。 */
        date: integer("date").notNull(),
        /** 'collecting'（NG募集中） | 'published'（割当公開済み） */
        status: text("status").notNull().default("collecting"),
        /** NG 提出締切（ms epoch）。任意。 */
        submissionDeadline: integer("submission_deadline"),
        adminPasswordHash: text("admin_password_hash").notNull(),
        adminAccessToken: text("admin_access_token").notNull(),
        /** デバイス（localStorage の userId）と紐付ける作成者識別子。任意。 */
        createdByUserId: text("created_by_user_id"),
        createdAt: integer("created_at").notNull(),
        deletedAt: integer("deleted_at"),
    },
    (t) => [index("idx_shift_boards_created_by").on(t.createdByUserId)]
);

/**
 * シフト枠。SeeFT 準拠で 役割(role)・場所(place)・定員(capacity) を持つ。
 * 開始/終了は ms epoch の絶対時刻で、作成 UI のタイムライン上で自由に設定・ドラッグ調整する。
 */
export const shiftSlots = sqliteTable(
    "shift_slots",
    {
        id: text("id").primaryKey(),
        boardId: text("board_id")
            .notNull()
            .references(() => shiftBoards.id, { onDelete: "cascade" }),
        startsAt: integer("starts_at").notNull(), // ms epoch
        endsAt: integer("ends_at").notNull(), // ms epoch
        role: text("role").notNull(), // 役割 / タスク名
        place: text("place"), // 場所
        capacity: integer("capacity").notNull().default(1),
        sortOrder: integer("sort_order").notNull().default(0),
    },
    (t) => [index("idx_shift_slots_board").on(t.boardId)]
);

/**
 * シフト表に名前登録したメンバー（参加者相当）。
 * userId（デバイス）で本人を識別し、NG の再提出を許す。name/comment は PII 暗号化。
 */
export const shiftMembers = sqliteTable(
    "shift_members",
    {
        id: text("id").primaryKey(),
        boardId: text("board_id")
            .notNull()
            .references(() => shiftBoards.id, { onDelete: "cascade" }),
        userId: text("user_id").references(() => users.id),
        name: text("name").notNull(),
        comment: text("comment"),
        createdAt: integer("created_at").notNull(),
    },
    (t) => [
        index("idx_shift_members_board").on(t.boardId),
        index("idx_shift_members_board_user").on(t.boardId, t.userId),
    ]
);

/**
 * NG 申告。行が存在する = そのメンバーはその枠に出られない。
 * 自然キー (member_id, slot_id) を複合主キーとする（availabilities と同方針）。
 */
export const shiftUnavailabilities = sqliteTable(
    "shift_unavailabilities",
    {
        memberId: text("member_id")
            .notNull()
            .references(() => shiftMembers.id, { onDelete: "cascade" }),
        slotId: text("slot_id")
            .notNull()
            .references(() => shiftSlots.id, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.memberId, t.slotId] })]
);

/**
 * 確定割当。管理者が NG・定員を尊重して入れた (slot, member) のペア。
 */
export const shiftAssignments = sqliteTable(
    "shift_assignments",
    {
        slotId: text("slot_id")
            .notNull()
            .references(() => shiftSlots.id, { onDelete: "cascade" }),
        memberId: text("member_id")
            .notNull()
            .references(() => shiftMembers.id, { onDelete: "cascade" }),
    },
    (t) => [
        primaryKey({ columns: [t.slotId, t.memberId] }),
        index("idx_shift_assignments_member").on(t.memberId),
    ]
);

/**
 * Google OAuth セッションテーブル
 * Googleアカウント連携情報
 */
export const googleOauthSessions = sqliteTable(
    "google_oauth_sessions",
    {
        sessionId: text("session_id").primaryKey(),
        userId: text("user_id").references(() => users.id),
        email: text("email").notNull(),
        accessToken: text("access_token").notNull(),
        refreshToken: text("refresh_token"),
        expiresAt: integer("expires_at").notNull(),
        createdAt: integer("created_at").notNull(),
        updatedAt: integer("updated_at").notNull(),
    },
    (t) => [index("idx_google_oauth_sessions_user_id").on(t.userId)]
);
