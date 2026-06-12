-- Add Google Calendar event ID to bookings for tracking created calendar events
ALTER TABLE office_hour_bookings ADD COLUMN google_calendar_event_id TEXT;
