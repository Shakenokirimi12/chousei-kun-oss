-- Migration number: 0007_office_hours.sql
-- Office Hour（Time Slot 予約）機能
-- 主催者はGoogle Calendar + 大学カレンダーの連携が必須。
-- Cron で主催者の予定を office_hour_host_busy にキャッシュする。

CREATE TABLE IF NOT EXISTS office_hours (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    -- 受付期間 (ms epoch)
    start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL,
    -- 曜日別の受付時間帯。JSON: [{"day":1,"start":"13:00","end":"17:00"}, ...]
    windows TEXT NOT NULL,
    slot_duration_min INTEGER NOT NULL,        -- 1枠の長さ(分): 15/30/60 等
    capacity_per_slot INTEGER NOT NULL DEFAULT 1, -- 1枠あたりの定員
    buffer_min INTEGER NOT NULL DEFAULT 0,     -- 枠間バッファ(分)
    -- 管理者認証（既存イベントと同じパターン）
    admin_password_hash TEXT NOT NULL,
    admin_access_token TEXT NOT NULL,
    -- 主催者の連携情報（Cron で使うため永続化）
    host_user_id TEXT NOT NULL REFERENCES users(id),
    host_google_session_id TEXT NOT NULL REFERENCES google_oauth_sessions(session_id),
    host_campus_uid TEXT NOT NULL,              -- 暗号化保存（AES-GCM）
    host_campus_pass TEXT NOT NULL,             -- 暗号化保存（AES-GCM）
    -- 同期メタ
    last_sync_at INTEGER,                       -- 最終同期成功時刻(ms)
    last_sync_error TEXT,                       -- 直近の同期エラー（任意）
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_office_hours_host_user_id ON office_hours(host_user_id);
CREATE INDEX IF NOT EXISTS idx_office_hours_end_date ON office_hours(end_date);

-- 個々の予約（1枠複数人可。capacity チェックは select COUNT → insert で対応）
CREATE TABLE IF NOT EXISTS office_hour_bookings (
    id TEXT PRIMARY KEY,
    office_hour_id TEXT NOT NULL REFERENCES office_hours(id) ON DELETE CASCADE,
    slot_start INTEGER NOT NULL,                -- 枠の開始時刻(ms epoch)。同じ枠の予約は同一値。
    name TEXT NOT NULL,
    comment TEXT,
    email TEXT,
    user_id TEXT REFERENCES users(id),          -- 同一ユーザーの重複予約防止
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_office_hour_bookings_oh_slot ON office_hour_bookings(office_hour_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_office_hour_bookings_user ON office_hour_bookings(office_hour_id, user_id);

-- 主催者の Busy 予定キャッシュ（Cron が毎回 office_hour_id 単位で洗い替え）
CREATE TABLE IF NOT EXISTS office_hour_host_busy (
    id TEXT PRIMARY KEY,
    office_hour_id TEXT NOT NULL REFERENCES office_hours(id) ON DELETE CASCADE,
    source TEXT NOT NULL,                       -- 'google' | 'campus'
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    summary TEXT,
    fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_office_hour_host_busy_oh_start ON office_hour_host_busy(office_hour_id, start_ms);
