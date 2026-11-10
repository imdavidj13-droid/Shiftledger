-- Existing shift IDs, assignments and timestamps remain valid.
ALTER TABLE shifts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1);
CREATE INDEX idx_shifts_location_time ON shifts(organisation_id,location_id,starts_at_utc,id);
