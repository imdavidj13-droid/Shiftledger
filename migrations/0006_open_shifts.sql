-- Existing unassigned shifts retain their status and are not advertised as vacancies.
ALTER TABLE shifts ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0,1) AND (is_open=0 OR employee_id IS NULL));
CREATE UNIQUE INDEX idx_shifts_org_id ON shifts(organisation_id,id);

CREATE TABLE shift_claims (
  organisation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','cancelled')),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (organisation_id,id),
  FOREIGN KEY (organisation_id,shift_id) REFERENCES shifts(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,employee_id) REFERENCES employees(organisation_id,id)
);
CREATE UNIQUE INDEX idx_shift_claim_capacity ON shift_claims(organisation_id,shift_id)
  WHERE status IN ('pending','approved');
CREATE INDEX idx_shift_claim_history ON shift_claims(organisation_id,shift_id,requested_at DESC,id);
