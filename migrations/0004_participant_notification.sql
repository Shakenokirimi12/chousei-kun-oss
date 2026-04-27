-- Migration number: 0004_participant_notification.sql
ALTER TABLE participants ADD COLUMN notify_on_finalize INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN notification_email TEXT;
