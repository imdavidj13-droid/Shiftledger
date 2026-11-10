-- Shared employee identities remain in employees; optional workforce metadata extends them.
CREATE TABLE employee_profiles (
  organisation_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  primary_location_id TEXT,
  PRIMARY KEY (organisation_id,employee_id),
  FOREIGN KEY (organisation_id,employee_id) REFERENCES employees(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,primary_location_id) REFERENCES locations(organisation_id,id)
);

CREATE TRIGGER clear_unassigned_primary_location AFTER DELETE ON employee_locations
BEGIN
  UPDATE employee_profiles SET primary_location_id=NULL WHERE organisation_id=OLD.organisation_id
    AND employee_id=OLD.employee_id AND primary_location_id=OLD.location_id;
END;

CREATE TRIGGER clear_archived_primary_location AFTER UPDATE OF archived_at ON locations
WHEN NEW.archived_at IS NOT NULL
BEGIN
  UPDATE employee_profiles SET primary_location_id=NULL WHERE organisation_id=NEW.organisation_id AND primary_location_id=NEW.id;
END;
