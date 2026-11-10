-- Timekeeping references existing staff and optional published rota assignments.
CREATE TABLE time_entries (
  organisation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  shift_id TEXT,
  clock_in_utc TEXT NOT NULL,
  clock_out_utc TEXT CHECK (clock_out_utc IS NULL OR clock_out_utc>clock_in_utc),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>=1),
  approved_at TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((status='open')=(clock_out_utc IS NULL)),
  PRIMARY KEY (organisation_id,id),
  FOREIGN KEY (organisation_id,employee_id) REFERENCES employees(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id) REFERENCES locations(organisation_id,id),
  FOREIGN KEY (organisation_id,shift_id) REFERENCES shifts(organisation_id,id)
);
CREATE UNIQUE INDEX idx_time_employee_open ON time_entries(organisation_id,employee_id) WHERE status='open';
CREATE UNIQUE INDEX idx_time_shift ON time_entries(organisation_id,shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX idx_time_employee_period ON time_entries(organisation_id,employee_id,clock_in_utc);
CREATE INDEX idx_time_location_period ON time_entries(organisation_id,location_id,clock_in_utc,id);

CREATE TABLE time_breaks (
  organisation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('paid','unpaid')),
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT CHECK (ended_at_utc IS NULL OR ended_at_utc>started_at_utc),
  PRIMARY KEY (organisation_id,id),
  FOREIGN KEY (organisation_id,entry_id) REFERENCES time_entries(organisation_id,id)
);
CREATE UNIQUE INDEX idx_time_open_break ON time_breaks(organisation_id,entry_id) WHERE ended_at_utc IS NULL;
CREATE INDEX idx_time_break_entry ON time_breaks(organisation_id,entry_id,started_at_utc);
