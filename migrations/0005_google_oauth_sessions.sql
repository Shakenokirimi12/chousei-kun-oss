-- Migration number: 0005_google_oauth_sessions.sql
CREATE TABLE IF NOT EXISTS google_oauth_sessions (
    session_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
