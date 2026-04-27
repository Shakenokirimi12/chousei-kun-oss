-- Migration number: 0002_admin_auth.sql
ALTER TABLE events ADD COLUMN admin_password_hash TEXT;
ALTER TABLE events ADD COLUMN admin_access_token TEXT;
