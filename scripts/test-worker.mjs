import { createHash, pbkdf2Sync } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { coverEmail, employeeEmail, expiredToken, fixtureSessions, managerEmail, ownerEmail, password, resetToken, verifyToken } from '../tests/fixtures.mjs';

const root = mkdtempSync(join(tmpdir(), 'shiftledger-tests-'));
const fixture = join(root, 'fixture.sql');
const wrangler = ['node_modules/wrangler/bin/wrangler.js'];
const legacy = process.argv.includes('--legacy');
const localConfigPath = 'wrangler.staging.jsonc';
const config = ['--config', legacy ? join(root,'wrangler.legacy.json') : localConfigPath, '--persist-to', root];
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const sql = value => "'" + value.replaceAll("'", "''") + "'";
const sha = token => createHash('sha256').update(token).digest('hex');
const salt = 'synthetic-salt';
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
const users = [
  ['owner', ownerEmail, 'Workspace Owner', true],
  ['manager', managerEmail, 'Branch Manager', true],
  ['cover', coverEmail, 'Cover Employee', true],
  ['employee', employeeEmail, 'Branch Employee', true],
  ['reset-user', 'reset@example.test', 'Recovery User', true],
  ['verify-user', 'verify@example.test', 'Verification User', false],
  ['onboard-user', 'onboard@example.test', 'New Owner', true],
  ['join-user', 'join@example.test', 'New Employee', true],
  ['join-manager', 'joining-manager@example.test', 'New Manager', true],
  ['browser-onboard', 'browser-onboard@example.test', 'New Business Owner', true]
];
const seed = `
INSERT INTO users (id,email_normalized,display_name,password_hash,password_salt,email_verified_at) VALUES
${users.map(([id,email,name,verified]) => '(' + [id,email,name,hash,salt].map(sql).join(',') + (verified ? ",'2026-01-01T00:00:00.000Z')" : ',NULL)')).join(',\n')};
INSERT INTO sessions (token_hash,user_id,expires_at) VALUES
${users.filter(([,email]) => fixtureSessions[email]).map(([id,email]) =>
  "('" + sha(fixtureSessions[email]) + "','" + id + "','2099-01-01T00:00:00.000Z')").join(',\n')};
INSERT INTO organisations (id,name,slug,country_code,time_zone,currency_code) VALUES
 ('shop','Fixture Shop','fixture-shop','GB','Europe/London','GBP'),
 ('other','Other Business','other-business','US','America/New_York','USD');
INSERT INTO memberships (organisation_id,user_id,role) VALUES
 ('shop','owner','owner'),('shop','manager','manager'),('shop','employee','employee'),('shop','cover','employee'),('other','owner','owner');
INSERT INTO locations (id,organisation_id,name,time_zone) VALUES
 ('north','shop','North','Europe/London'),('south','shop','South','America/New_York'),
 ('west','shop','West','America/Los_Angeles'),('foreign','other','Other Branch','America/New_York');
INSERT INTO location_access (organisation_id,location_id,user_id) VALUES ('shop','north','manager');
INSERT INTO employees (id,organisation_id,user_id,display_name) VALUES
 ('shared','shop','employee','Shared employee'),('south-only','shop',NULL,'South only'),
 ('foreign-employee','other',NULL,'Foreign employee'),('cover-staff','shop','cover','Cover Employee');
INSERT INTO employee_locations VALUES ('shop','shared','north'),('shop','shared','south'),('shop','south-only','south'),('shop','cover-staff','south');
INSERT INTO auth_tokens (token_hash,user_id,purpose,expires_at) VALUES
 ('${sha(verifyToken)}','verify-user','verify_email','2099-01-01T00:00:00.000Z'),
 ('${sha(resetToken)}','reset-user','reset_password','2099-01-01T00:00:00.000Z'),
 ('${sha(expiredToken)}','verify-user','verify_email','2000-01-01T00:00:00.000Z');
`;
function run(args) {
  const result = spawnSync(process.execPath, [...wrangler, ...args, ...config], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Wrangler test setup failed.');
}

try {
  if (legacy) {
    const migrationDir = join(root,'migrations');
    mkdirSync(migrationDir);
    for (const file of readdirSync('migrations').filter(name => /^000[1-5]_.*\.sql$/.test(name))) {
      copyFileSync(join('migrations',file),join(migrationDir,file));
    }
    const legacyConfig = JSON.parse(readFileSync(localConfigPath,'utf8'));
    legacyConfig.main = resolve(legacyConfig.main);
    legacyConfig.assets.directory = resolve(legacyConfig.assets.directory);
    legacyConfig.d1_databases[0].migrations_dir = migrationDir;
    writeFileSync(config[1],JSON.stringify(legacyConfig));
  }
  writeFileSync(fixture, seed);
  run(['d1', 'migrations', 'apply', 'DB', '--local']);
  run(['d1', 'execute', 'DB', '--local', '--file', fixture]);
  const worker = spawn(process.execPath, [...wrangler, 'dev', '--local', '--ip', '127.0.0.1',
    '--port', process.argv[2], ...config], { stdio: 'inherit', env });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => worker.kill(signal));
  worker.on('error', error => { console.error(error); process.exitCode = 1; });
  worker.on('exit', code => {
    rmSync(root, { recursive: true, force: true });
    process.exitCode = code ?? 0;
  });
} catch (error) {
  rmSync(root, { recursive: true, force: true });
  throw error;
}
