const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const serverPath = path.join(rootDir, 'server.js');

test('Server Smoke Test - Node syntax check (node -c server.js)', () => {
  assert.doesNotThrow(() => {
    execSync(`node -c "${serverPath}"`, { stdio: 'pipe' });
  }, 'server.js must pass node syntax check without errors');
});

test('Server Smoke Test - Verify core endpoint definitions', () => {
  const content = fs.readFileSync(serverPath, 'utf8');

  const requiredEndpoints = [
    "app.get('/api/financials'",
    "app.get('/api/progress'",
    "app.get('/api/crawler-settings'",
    "app.get('/api/stream'",
    "app.get('/api/scrape'",
    "app.post('/api/clear-cache'",
    "app.post('/api/auth/login'",
    "app.post('/api/watchlist/sync'"
  ];

  requiredEndpoints.forEach(endpoint => {
    assert.strictEqual(
      content.includes(endpoint),
      true,
      `Expected server.js to define endpoint handler: ${endpoint}`
    );
  });
});
