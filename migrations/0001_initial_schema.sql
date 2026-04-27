-- Migration number: 0001_initial_schema.sql

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    candidates TEXT NOT NULL, -- JSON array of strings
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    name TEXT NOT NULL,
    comment TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS availabilities (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL,
    candidate_idx INTEGER NOT NULL,
    status INTEGER NOT NULL, -- 0: X, 1: Triangle, 2: O
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_participants_event_id ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_availabilities_participant_id ON availabilities(participant_id);
