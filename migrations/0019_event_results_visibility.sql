-- 日毎の出欠確認（終日）イベントで、回答結果を全員に公開するか管理者が選べるようにする。
ALTER TABLE events ADD COLUMN results_visible_to_all INTEGER NOT NULL DEFAULT 1;
