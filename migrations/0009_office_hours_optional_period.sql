-- Migration number: 0009_office_hours_optional_period.sql
-- 受付期間を任意（NULL許可）にする。
-- SQLite はカラム NOT NULL 制約を直接外せないため、テーブル再作成で対応する。

CREATE TABLE office_hours_new (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    start_date INTEGER,                         -- NULL = 「今日から」
    end_date INTEGER,                           -- NULL = 「無期限」
    windows TEXT NOT NULL,
    slot_duration_min INTEGER NOT NULL,
    capacity_per_slot INTEGER NOT NULL DEFAULT 1,
    buffer_min INTEGER NOT NULL DEFAULT 0,
    admin_password_hash TEXT NOT NULL,
    admin_access_token TEXT NOT NULL,
    host_user_id TEXT NOT NULL REFERENCES users(id),
    host_google_session_id TEXT NOT NULL REFERENCES google_oauth_sessions(session_id),
    host_ical_url TEXT NOT NULL,
    last_sync_at INTEGER,
    last_sync_error TEXT,
    created_at INTEGER NOT NULL
);

INSERT INTO office_hours_new
SELECT id, title, description, start_date, end_date, windows, slot_duration_min,
       capacity_per_slot, buffer_min, admin_password_hash, admin_access_token,
       host_user_id, host_google_session_id, host_ical_url, last_sync_at, last_sync_error, created_at
FROM office_hours;

DROP TABLE office_hours;
ALTER TABLE office_hours_new RENAME TO office_hours;

CREATE INDEX IF NOT EXISTS idx_office_hours_host_user_id ON office_hours(host_user_id);
CREATE INDEX IF NOT EXISTS idx_office_hours_end_date ON office_hours(end_date);
