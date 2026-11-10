-- ShiftLedger foundation schema. All workforce records must be scoped by organisation.
PRAGMA foreign_keys = ON;

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE memberships (
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','manager','employee')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','suspended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (organisation_id,user_id)
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (organisation_id,id)
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  employment_status TEXT NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,user_id)
);

CREATE TABLE shifts (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  employee_id TEXT,
  starts_at_utc TEXT NOT NULL,
  ends_at_utc TEXT NOT NULL,
  unpaid_break_minutes INTEGER NOT NULL DEFAULT 0 CHECK(unpaid_break_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(ends_at_utc > starts_at_utc),
  FOREIGN KEY(organisation_id,location_id) REFERENCES locations(organisation_id,id),
  FOREIGN KEY(organisation_id,employee_id) REFERENCES employees(organisation_id,id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_memberships_user ON memberships(user_id,status);
CREATE INDEX idx_employees_organisation ON employees(organisation_id,employment_status);
CREATE INDEX idx_shifts_organisation_time ON shifts(organisation_id,starts_at_utc);
CREATE INDEX idx_shifts_employee_time ON shifts(organisation_id,employee_id,starts_at_utc);
CREATE INDEX idx_audit_organisation_time ON audit_events(organisation_id,occurred_at);
