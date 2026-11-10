-- Multi-location foundations; existing organisations and locations remain intact.
ALTER TABLE organisations ADD COLUMN industry TEXT;
ALTER TABLE organisations ADD COLUMN team_size_band TEXT;
ALTER TABLE organisations ADD COLUMN week_start INTEGER NOT NULL DEFAULT 1 CHECK(week_start IN (0,1,6));
ALTER TABLE organisations ADD COLUMN time_format TEXT NOT NULL DEFAULT '24h' CHECK(time_format IN ('12h','24h'));

-- One manager can have access to several locations within the same organisation.
CREATE TABLE IF NOT EXISTS location_access (
  organisation_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (organisation_id,location_id,user_id),
  FOREIGN KEY (organisation_id,location_id) REFERENCES locations(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,user_id) REFERENCES memberships(organisation_id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_location_access_user ON location_access(organisation_id,user_id,location_id);

-- Employees may serve multiple locations, without being duplicated in the organisation.
CREATE TABLE IF NOT EXISTS employee_locations (
  organisation_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  PRIMARY KEY (organisation_id,employee_id,location_id),
  FOREIGN KEY (organisation_id,employee_id) REFERENCES employees(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,location_id) REFERENCES locations(organisation_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_employee_locations_location ON employee_locations(organisation_id,location_id);
