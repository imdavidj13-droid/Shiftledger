import { spawnSync } from 'node:child_process';

const commitPattern = /^[a-f0-9]{40}$/;
const supplied = process.env.WORKERS_CI_COMMIT_SHA;
if (supplied && !commitPattern.test(supplied)) throw new Error('Invalid Workers Builds commit SHA.');
const git = args => spawnSync('git', args, { encoding: 'utf8' });
const worktree = git(['status', '--porcelain']);
const head = worktree.status === 0 && !worktree.stdout.trim() ? git(['rev-parse', 'HEAD']).stdout?.trim() : '';
const commit = supplied || (head && commitPattern.test(head) ? head : '');
const tag = commit ? ['--tag', commit] : [];

const deploy = spawnSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'deploy', ...tag, ...process.argv.slice(2)
], { stdio: 'inherit' });
if (deploy.error) throw deploy.error;
process.exitCode = deploy.status ?? 1;
