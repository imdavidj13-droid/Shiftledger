import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const template = JSON.parse(readFileSync('wrangler.staging.jsonc', 'utf8'));
const production = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const [command] = process.argv.slice(2);
if (!['deploy', 'migrate', 'list'].includes(command)) {
  throw new Error('Use npm run staging -- deploy, migrate or list.');
}

const id = process.env.SHIFTLEDGER_STAGING_DB_ID?.toLowerCase();
if (!id || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) ||
    id === template.d1_databases[0].database_id ||
    production.d1_databases.some(database => database.database_id.toLowerCase() === id)) {
  throw new Error('Set SHIFTLEDGER_STAGING_DB_ID to the separate staging database UUID.');
}

const run = (program, args) => {
  const result = spawnSync(program, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(program + ' failed with status ' + result.status);
};

if (command === 'deploy') run('npm', ['run', 'verify']);
template.d1_databases[0].database_id = id;
const config = '.shiftledger-staging-' + randomUUID() + '.jsonc';
writeFileSync(config, JSON.stringify(template), { flag: 'wx' });
try {
  const args = command === 'deploy' ? ['deploy'] : [
    'd1', 'migrations', command === 'migrate' ? 'apply' : 'list', 'DB', '--remote'
  ];
  run('npx', ['--no-install', 'wrangler', ...args, '--config', config]);
} finally {
  unlinkSync(config);
}
