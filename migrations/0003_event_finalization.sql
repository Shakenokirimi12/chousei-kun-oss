-- Migration number: 0003_event_finalization.sql
ALTER TABLE events ADD COLUMN confirmed_candidate_idx INTEGER;
