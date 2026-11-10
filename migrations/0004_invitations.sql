-- Additive invitation and branch scope storage. Existing memberships are preserved.
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','employee')),
  employee_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  acceptance_id TEXT UNIQUE,
  revoked_at TEXT,
  UNIQUE(organisation_id,id),
  CHECK(role='employee' OR employee_id IS NULL),
  FOREIGN KEY(organisation_id,employee_id) REFERENCES employees(organisation_id,id)
);
CREATE UNIQUE INDEX idx_invitations_pending ON invitations(organisation_id,email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_invitations_organisation_time ON invitations(organisation_id,created_at DESC,id);

CREATE TABLE invitation_locations (
  organisation_id TEXT NOT NULL,
  invitation_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  PRIMARY KEY(organisation_id,invitation_id,location_id),
  FOREIGN KEY(organisation_id,invitation_id) REFERENCES invitations(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organisation_id,location_id) REFERENCES locations(organisation_id,id)
);
