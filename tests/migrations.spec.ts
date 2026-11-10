import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';

test('additive upgrades preserve existing user, organisation, membership, shift and session rows', () => {
  const db = new DatabaseSync(':memory:');
  const apply = (name: string) => db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  try {
    apply('0001_initial.sql');
    apply('0002_identity.sql');
    apply('0003_multilocation.sql');
    db.exec(`
      INSERT INTO users(id,email_normalized,display_name,password_hash,password_salt,email_verified_at)
        VALUES('owner','owner@example.test','Fixture Owner','fixture-hash','fixture-salt','2026-01-01T00:00:00.000Z');
      INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('fixture-session','owner','2099-01-01T00:00:00.000Z');
      INSERT INTO organisations(id,name,slug,country_code,time_zone,currency_code)
        VALUES('org','Preserved organisation','fixture-org','GB','Europe/London','GBP');
      INSERT INTO memberships(organisation_id,user_id,role) VALUES('org','owner','owner');
      INSERT INTO locations(id,organisation_id,name,time_zone) VALUES('branch','org','Branch','Europe/London');
      INSERT INTO shifts(id,organisation_id,location_id,starts_at_utc,ends_at_utc)
        VALUES('shift','org','branch','2030-01-01T09:00:00.000Z','2030-01-01T17:00:00.000Z');
    `);
    apply('0004_invitations.sql');
    apply('0005_shift_revisions.sql');
    db.exec("UPDATE shifts SET status='published' WHERE id='shift'");
    apply('0006_open_shifts.sql');
    expect(db.prepare('SELECT status,is_open FROM shifts WHERE id=?').get('shift'))
      .toMatchObject({ status: 'published', is_open: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM shift_claims').get()).toMatchObject({ count: 0 });
    expect(db.prepare('SELECT password_hash,email_verified_at FROM users WHERE id=?').get('owner'))
      .toMatchObject({ password_hash: 'fixture-hash', email_verified_at: '2026-01-01T00:00:00.000Z' });
    expect(db.prepare('SELECT token_hash FROM sessions WHERE user_id=?').get('owner')).toMatchObject({ token_hash: 'fixture-session' });
    expect(db.prepare('SELECT name FROM organisations WHERE id=?').get('org')).toMatchObject({ name: 'Preserved organisation' });
    expect(db.prepare('SELECT role FROM memberships WHERE user_id=?').get('owner')).toMatchObject({ role: 'owner' });
    expect(db.prepare('SELECT revision,starts_at_utc FROM shifts WHERE id=?').get('shift'))
      .toMatchObject({ revision: 1, starts_at_utc: '2030-01-01T09:00:00.000Z' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
