-- Leave is stored against the same employee and location identities as the rota.
CREATE TABLE leave_requests (
  organisation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('holiday','sickness','other')),
  first_date TEXT NOT NULL,
  last_date TEXT NOT NULL CHECK (last_date>=first_date),
  time_zone TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  ends_at_utc TEXT NOT NULL CHECK (ends_at_utc>starts_at_utc),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','cancelled')),
  requested_at TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (organisation_id,id),
  FOREIGN KEY (organisation_id,employee_id) REFERENCES employees(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id) REFERENCES locations(organisation_id,id)
);
CREATE INDEX idx_leave_employee_time ON leave_requests(organisation_id,employee_id,starts_at_utc)
  WHERE status IN ('pending','approved');
CREATE INDEX idx_leave_branch_history ON leave_requests(organisation_id,location_id,requested_at DESC,id);
