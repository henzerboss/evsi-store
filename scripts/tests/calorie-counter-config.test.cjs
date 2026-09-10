const assert = require('node:assert/strict');
const { before, beforeEach, afterEach, after, test, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const output = mkdtempSync(path.join(root, '.ccai-config-test-'));
let getCalorieCounterConfig, route;
const keys = [
  'CCAI_FREE_ANALYSES_EXISTING', 'CCAI_FREE_ANALYSES_NEW',
  'CCAI_PREMIUM_ANALYSES_EXISTING', 'CCAI_PREMIUM_ANALYSES_NEW', 'CCAI_FIRST_DAY_FREE',
  'CALORIE_COUNTER_CLIENT_TOKENS', 'CALORIE_COUNTER_CLIENT_TOKEN', 'SERVER_CLIENT_TOKEN',
];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const defaults = {
  schemaVersion: 1,
  limits: { existingUsers: { free: 5, premium: 50 }, newUsers: { free: 5, premium: 50 } },
  firstDayFreeForNewUsers: false,
};
const request = (headers = { 'X-Client-Token': 'config-test-token' }) =>
  new Request('https://evsi.store/api/calorie-counter/config', { headers });

before(() => {
  // Compile the actual route and auth helper, without changing the site build
  // configuration or requiring an additional test framework.
  execFileSync(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    'src/app/api/calorie-counter/config/route.ts',
    '--rootDir', 'src', '--outDir', output, '--target', 'ES2022',
    '--module', 'commonjs', '--moduleResolution', 'node', '--lib', 'ES2022,DOM',
    '--types', 'node', '--strict', '--esModuleInterop', '--skipLibCheck',
  ], { cwd: root, stdio: 'pipe' });
  ({ getCalorieCounterConfig } = require(path.join(output, 'lib/calorieCounterConfig.js')));
  route = require(path.join(output, 'app/api/calorie-counter/config/route.js'));
});
beforeEach(() => {
  keys.forEach(key => { delete process.env[key]; });
  process.env.CALORIE_COUNTER_CLIENT_TOKEN = 'config-test-token';
});
afterEach(() => {
  keys.forEach(key => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  });
  mock.restoreAll();
});
after(() => rmSync(output, { recursive: true, force: true }));

test('missing configuration preserves 5/50 for both cohorts and disables the free first day', () => {
  assert.deepEqual(getCalorieCounterConfig({}), defaults);
});
test('all four quotas can differ; Premium alone accepts unlimited', () => {
  assert.deepEqual(getCalorieCounterConfig({
    CCAI_FREE_ANALYSES_EXISTING: '3', CCAI_FREE_ANALYSES_NEW: '12',
    CCAI_PREMIUM_ANALYSES_EXISTING: '80', CCAI_PREMIUM_ANALYSES_NEW: ' unlimited ',
    CCAI_FIRST_DAY_FREE: 'true',
  }), {
    schemaVersion: 1,
    limits: { existingUsers: { free: 3, premium: 80 }, newUsers: { free: 12, premium: 'unlimited' } },
    firstDayFreeForNewUsers: true,
  });
});
test('zero is a quota, never a sentinel for unlimited', () => {
  const config = getCalorieCounterConfig({
    CCAI_FREE_ANALYSES_EXISTING: '0', CCAI_FREE_ANALYSES_NEW: '0',
    CCAI_PREMIUM_ANALYSES_EXISTING: '0', CCAI_PREMIUM_ANALYSES_NEW: '0',
  });
  assert.deepEqual(config.limits, { existingUsers: { free: 0, premium: 0 }, newUsers: { free: 0, premium: 0 } });
});
for (const invalid of ['', ' ', '-1', '5.5', '12junk', '1e3', 'Infinity', 'NaN', 'null', 'true', '9007199254740992']) {
  test(`invalid numeric value ${JSON.stringify(invalid)} falls back for each affected field`, () => {
    const env = Object.fromEntries(keys.slice(0, 4).map(key => [key, invalid]));
    assert.deepEqual(getCalorieCounterConfig(env), defaults);
  });
}
test('an invalid field does not discard other valid values or accidentally enable the trial', () => {
  assert.deepEqual(getCalorieCounterConfig({
    CCAI_FREE_ANALYSES_EXISTING: 'unlimited', CCAI_FREE_ANALYSES_NEW: '20',
    CCAI_PREMIUM_ANALYSES_EXISTING: 'UNLIMITED', CCAI_PREMIUM_ANALYSES_NEW: '-1',
    CCAI_FIRST_DAY_FREE: 'falls',
  }), {
    ...defaults,
    limits: { existingUsers: { free: 5, premium: 'unlimited' }, newUsers: { free: 20, premium: 50 } },
  });
});
for (const disabled of [undefined, '', 'false', ' FALSE ', 'falls', 'yes', '1']) {
  test(`first-day flag ${JSON.stringify(disabled)} stays disabled`, () => {
    assert.equal(getCalorieCounterConfig({ CCAI_FIRST_DAY_FREE: disabled }).firstDayFreeForNewUsers, false);
  });
}
test('explicit true with whitespace/case is accepted', () => {
  assert.equal(getCalorieCounterConfig({ CCAI_FIRST_DAY_FREE: ' TRUE ' }).firstDayFreeForNewUsers, true);
});
test('an authorized GET returns the contract and no-store/CORS headers', async () => {
  const result = await route.GET(request({ 'X-Client-Token': 'config-test-token', Origin: 'http://localhost:8081' }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), defaults);
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(result.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal(result.headers.get('vary'), 'Origin');
});
test('values are reread for each request; tokens and other env values are never returned', async () => {
  assert.deepEqual(await (await route.GET(request())).json(), defaults);
  process.env.CCAI_FREE_ANALYSES_NEW = '11';
  process.env.CCAI_PREMIUM_ANALYSES_NEW = 'unlimited';
  process.env.CCAI_FIRST_DAY_FREE = 'true';
  const body = await (await route.GET(request())).json();
  assert.deepEqual(body, {
    ...defaults,
    limits: { existingUsers: { free: 5, premium: 50 }, newUsers: { free: 11, premium: 'unlimited' } },
    firstDayFreeForNewUsers: true,
  });
  assert.ok(!JSON.stringify(body).includes('config-test-token'));
});
test('GET query parameters cannot override the server configuration', async () => {
  const req = new Request('https://evsi.store/api/calorie-counter/config?CCAI_FREE_ANALYSES_NEW=999&firstDayFreeForNewUsers=true', { headers: { 'X-Client-Token': 'config-test-token' } });
  assert.deepEqual(await (await route.GET(req)).json(), defaults);
});
test('missing or incorrect authentication remains forbidden', async () => {
  for (const headers of [{}, { 'X-Client-Token': 'invalid' }]) {
    const response = await route.GET(request(headers));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Forbidden' });
  }
});
test('missing server authentication fails closed as in existing AI routes', async () => {
  delete process.env.CALORIE_COUNTER_CLIENT_TOKEN;
  mock.method(console, 'error', () => {});
  assert.equal((await route.GET(request())).status, 503);
});
test('the existing shared token and staged token rotation keep working', async () => {
  delete process.env.CALORIE_COUNTER_CLIENT_TOKEN;
  process.env.SERVER_CLIENT_TOKEN = 'config-test-token';
  assert.equal((await route.GET(request())).status, 200);
  delete process.env.SERVER_CLIENT_TOKEN;
  process.env.CALORIE_COUNTER_CLIENT_TOKENS = 'old-test-token, config-test-token';
  assert.equal((await route.GET(request())).status, 200);
  assert.equal((await route.GET(request({ 'X-Client-Token': 'old-test-token' }))).status, 200);
});
test('browser preflight is available before authentication', async () => {
  const response = await route.OPTIONS(request({ Origin: 'http://localhost:8081' }));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('access-control-allow-methods'), /GET/);
  assert.match(response.headers.get('access-control-allow-headers'), /X-Client-Token/);
});
