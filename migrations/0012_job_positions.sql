-- Job positions are business roles, never authentication/permission roles.
-- Additive: no existing employee, shift, or organisation records are changed.
CREATE TABLE job_positions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 2 AND 100),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(organisation_id,id),
  UNIQUE(organisation_id,name)
);
CREATE INDEX idx_job_positions_organisation ON job_positions(organisation_id,archived_at,name);

CREATE TABLE employee_job_positions (
  organisation_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  PRIMARY KEY(organisation_id,employee_id),
  FOREIGN KEY(organisation_id,employee_id) REFERENCES employees(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organisation_id,position_id) REFERENCES job_positions(organisation_id,id)
);
CREATE INDEX idx_employee_job_positions_position ON employee_job_positions(organisation_id,position_id);
