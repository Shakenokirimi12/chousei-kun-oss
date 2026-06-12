-- Migration number: 0008_office_hours_ical_url.sql
-- 主催者の大学カレンダー連携を「学籍番号/パスワード」から「iCal URL」に変更。
-- 認証情報の永続保管を避け、より安全でシンプルな構成にする。

ALTER TABLE office_hours DROP COLUMN host_campus_uid;
ALTER TABLE office_hours DROP COLUMN host_campus_pass;
ALTER TABLE office_hours ADD COLUMN host_ical_url TEXT NOT NULL DEFAULT '';
