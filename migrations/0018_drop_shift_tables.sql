-- Migration number: 0018_drop_shift_tables.sql
-- シフト調整機能（隠し機能）の撤去。関連テーブルを全て削除する。
-- 子テーブルから順に DROP（外部キー依存順）。IF EXISTS で冪等・再実行安全。

DROP TABLE IF EXISTS shift_assignments;
DROP TABLE IF EXISTS shift_unavailable_ranges;
DROP TABLE IF EXISTS shift_members;
DROP TABLE IF EXISTS shift_slots;
DROP TABLE IF EXISTS shift_boards;
