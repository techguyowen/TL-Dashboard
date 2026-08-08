const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '../server.js');

test('Backend: server.js contains target URLs for triangleliquidators.com', () => {
  const content = fs.readFileSync(SERVER_PATH, 'utf8');

  // Verify scraper and auth target URLs
  assert.strictEqual(
    content.includes("https://auction.triangleliquidators.com/"),
    true,
    'server.js must contain target homepage URL https://auction.triangleliquidators.com/'
  );
  assert.strictEqual(
    content.includes("https://auction.triangleliquidators.com/login"),
    true,
    'server.js must contain login target URL https://auction.triangleliquidators.com/login'
  );
  assert.strictEqual(
    content.includes("https://auction.triangleliquidators.com/watched-lots"),
    true,
    'server.js must contain watched-lots target URL https://auction.triangleliquidators.com/watched-lots'
  );
});

test('Backend: server.js defines expected API routes and status messages', () => {
  const content = fs.readFileSync(SERVER_PATH, 'utf8');

  // Verify API route definitions
  assert.strictEqual(content.includes('/api/auth/login'), true, 'server.js must define /api/auth/login endpoint');
  assert.strictEqual(content.includes('/api/watchlist/sync'), true, 'server.js must define /api/watchlist/sync endpoint');
  assert.strictEqual(content.includes('/api/scrape'), true, 'server.js must define /api/scrape endpoint');
  assert.strictEqual(content.includes('/api/progress'), true, 'server.js must define /api/progress endpoint');
  assert.strictEqual(content.includes('/api/financials'), true, 'server.js must define /api/financials endpoint');
  assert.strictEqual(content.includes('/api/clear-cache'), true, 'server.js must define /api/clear-cache endpoint');

  // Verify user status messages
  assert.strictEqual(
    content.includes('imported from auction account.'),
    true,
    'server.js must present watchlist sync message'
  );
  assert.strictEqual(
    content.includes('🚀 TL Auction Tracker Running'),
    true,
    'server.js must print startup banner'
  );
});
