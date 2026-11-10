-- A template is a branch-local draft preset, separate from published shift records.
CREATE TABLE shift_templates (
  organisation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  end_day_offset INTEGER NOT NULL CHECK (end_day_offset IN (0,1)),
  unpaid_break_minutes INTEGER NOT NULL CHECK (unpaid_break_minutes>=0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>=1),
  archived_at TEXT,
  PRIMARY KEY (organisation_id,id),
  FOREIGN KEY (organisation_id,location_id) REFERENCES locations(organisation_id,id)
);
CREATE UNIQUE INDEX idx_shift_template_active_name ON shift_templates(organisation_id,location_id,name COLLATE NOCASE)
  WHERE archived_at IS NULL;
