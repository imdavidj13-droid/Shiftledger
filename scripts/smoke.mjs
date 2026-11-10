import assert from 'node:assert/strict';

const [commit, base = 'https://shiftledger.imdavidj13.workers.dev'] = process.argv.slice(2);
assert.match(commit || '', /^[a-f0-9]{40}$/, 'Pass the expected full Git commit SHA.');

const checks = [
  ['/api/v1/health', 200],
  ['/api/v1/ready', 200],
  ['/api/v1/auth/me', 401],
  ['/api/v1/organisations', 401],
  ['/app/shiftledger-smoke/schedule?view=month', 200]
];
const responses = await Promise.all(checks.map(async ([path, expected]) => {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  assert.equal(response.status, expected, path);
  if (path.startsWith('/api/')) {
    assert.match(response.headers.get('content-type') || '', /^application\/json/, path);
    assert.ok(response.headers.get('x-request-id'), path + ' request ID');
    return response.json();
  }
  assert.match(response.headers.get('content-type') || '', /^text\/html/, path);
  return null;
}));
const [health, readiness] = responses;
assert.equal(health.commit, commit, 'The Worker is serving a different or untagged release.');
assert.ok(health.versionId, 'Cloudflare Worker version ID is missing.');
assert.equal(readiness.ok, true);
console.log(JSON.stringify({ commit: health.commit, workerVersion: health.versionId, checks: checks.length,
  databaseFeatures: readiness.features }, null, 2));
