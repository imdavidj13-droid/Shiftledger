-- Keep original assignments and revisions for review and audit.
CREATE TABLE shift_swaps (
  organisation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  offered_shift_id TEXT NOT NULL,
  requested_shift_id TEXT NOT NULL CHECK (offered_shift_id<>requested_shift_id),
  offering_employee_id TEXT NOT NULL,
  receiving_employee_id TEXT NOT NULL CHECK (offering_employee_id<>receiving_employee_id),
  offered_revision INTEGER NOT NULL CHECK (offered_revision>=1),
  requested_revision INTEGER NOT NULL CHECK (requested_revision>=1),
  status TEXT NOT NULL CHECK (status IN ('awaiting_employee','pending','approved','declined','cancelled')),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  consent_at TEXT,
  consent_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approval_id TEXT UNIQUE,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (organisation_id,id),
  FOREIGN KEY (organisation_id,offered_shift_id) REFERENCES shifts(organisation_id,id),
  FOREIGN KEY (organisation_id,requested_shift_id) REFERENCES shifts(organisation_id,id),
  FOREIGN KEY (organisation_id,offering_employee_id) REFERENCES employees(organisation_id,id),
  FOREIGN KEY (organisation_id,receiving_employee_id) REFERENCES employees(organisation_id,id)
);
CREATE INDEX idx_swap_recent ON shift_swaps(organisation_id,created_at DESC,id);
CREATE INDEX idx_swap_offer_active ON shift_swaps(organisation_id,offered_shift_id)
  WHERE status IN ('awaiting_employee','pending');
CREATE INDEX idx_swap_request_active ON shift_swaps(organisation_id,requested_shift_id)
  WHERE status IN ('awaiting_employee','pending');
