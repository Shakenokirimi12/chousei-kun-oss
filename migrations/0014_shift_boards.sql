-- Migration number: 0014_shift_boards.sql
-- シフト調整機能。1 日単位のシフト表に、役割・場所・定員を持つシフト枠を定義し、
-- メンバーは「出られない枠(NG)」だけを申告。管理者が NG・定員を尊重して割当を確定・公開する。
-- ルートからの導線は設けず、URL 直アクセスのみで到達する隠し機能。

CREATE TABLE IF NOT EXISTS shift_boards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    -- 対象日（JST 0:00 の ms epoch）
    date INTEGER NOT NULL,
    -- 'collecting'（NG募集中） | 'published'（割当公開済み）
    status TEXT NOT NULL DEFAULT 'collecting',
    -- NG 提出締切（ms epoch、任意）
    submission_deadline INTEGER,
    admin_password_hash TEXT NOT NULL,
    admin_access_token TEXT NOT NULL,
    created_by_user_id TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_shift_boards_created_by ON shift_boards(created_by_user_id);

CREATE TABLE IF NOT EXISTS shift_slots (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES shift_boards(id) ON DELETE CASCADE,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    role TEXT NOT NULL,
    place TEXT,
    capacity INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shift_slots_board ON shift_slots(board_id);

CREATE TABLE IF NOT EXISTS shift_members (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES shift_boards(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    comment TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shift_members_board ON shift_members(board_id);
CREATE INDEX IF NOT EXISTS idx_shift_members_board_user ON shift_members(board_id, user_id);

-- NG 申告（行が存在 = その枠に出られない）
CREATE TABLE IF NOT EXISTS shift_unavailabilities (
    member_id TEXT NOT NULL REFERENCES shift_members(id) ON DELETE CASCADE,
    slot_id TEXT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
    PRIMARY KEY (member_id, slot_id)
);

-- 確定割当（管理者が入れた slot×member ペア）
CREATE TABLE IF NOT EXISTS shift_assignments (
    slot_id TEXT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES shift_members(id) ON DELETE CASCADE,
    PRIMARY KEY (slot_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_assignments_member ON shift_assignments(member_id);
