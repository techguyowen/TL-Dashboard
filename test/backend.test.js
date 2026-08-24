const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '../server.js');

test('Backend: server.js contains target URLs for triangleliquidators.com', () => {
  const content = fs.readFileSync(SERVER_PATH, 'utf8');

  // Verify scraper and auth target URLs — updated for new bid.triangleliquidators.com site
  assert.strictEqual(
    content.includes("https://bid.triangleliquidators.com"),
    true,
    'server.js must contain new site base URL https://bid.triangleliquidators.com'
  );
  assert.strictEqual(
    content.includes("control-panel/active/watchlist"),
    true,
    'server.js must contain new active watchlist target URL control-panel/active/watchlist'
  );
  assert.strictEqual(
    content.includes("__NEXT_DATA__"),
    true,
    'server.js must extract data from __NEXT_DATA__ SSR JSON on the new Next.js site'
  );
  assert.strictEqual(
    content.includes("cdn.bid.triangleliquidators.com"),
    true,
    'server.js must reference new image CDN cdn.bid.triangleliquidators.com'
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
  assert.strictEqual(content.includes('/api/notifications/webhook-test'), true, 'server.js must define /api/notifications/webhook-test endpoint');
});

test('Backend: calculateFinancials accurately computes out-of-pocket costs and savings', () => {
  const { calculateFinancials } = require('../server');

  // Test case: $100 bid with $400 retail MSRP
  // BP = $15.00, Sub = $115.00, Tax = $8.34, CC = $3.70, Total = $127.04
  const fin = calculateFinancials(100, 400);
  assert.strictEqual(fin.currentBid, '100.00');
  assert.strictEqual(fin.buyerPremium, '15.00');
  assert.strictEqual(fin.salesTax, '8.34');
  assert.strictEqual(fin.ccFee, '3.70');
  assert.strictEqual(fin.totalCost, '127.04');
  assert.strictEqual(fin.retailPrice, '400.00');
  assert.strictEqual(fin.savingsPct, 68);
});

test('Backend: calculateDealScore produces accurate dynamic ratings (0-100) and badges', () => {
  const { calculateDealScore } = require('../server');

  // 1. Epic Steal (Score >= 90): Brand New Milwaukee tool, $10 bid, $300 MSRP (95%+ savings)
  const epic = calculateDealScore(10, 300, 'Brand New in Box', 'Milwaukee');
  assert.ok(epic.score >= 90, `Epic score should be >= 90, got ${epic.score}`);
  assert.strictEqual(epic.tier, 'EPIC STEAL');
  assert.strictEqual(epic.badgeClass, 'deal-epic');

  // 2. Great Deal (Score 75-89): Open Box DeWalt, $20 bid, $200 MSRP (87% savings)
  const great = calculateDealScore(20, 200, 'Open Box - Inspected', 'DeWalt');
  assert.ok(great.score >= 75 && great.score < 90, `Great deal score should be 75-89, got ${great.score}`);
  assert.strictEqual(great.tier, 'GREAT DEAL');
  assert.strictEqual(great.badgeClass, 'deal-great');

  // 3. Good Value (Score 50-74): Used Generic, $15 bid, $65 MSRP (71% savings)
  const good = calculateDealScore(15, 65, 'Used - Working Condition', 'Generic');
  assert.ok(good.score >= 50 && good.score < 75, `Good value score should be 50-74, got ${good.score}`);
  assert.strictEqual(good.tier, 'GOOD VALUE');
  assert.strictEqual(good.badgeClass, 'deal-good');

  // 4. Fair / Low Deal (Score < 50): As-Is Damaged Lot, $50 bid, $60 MSRP
  const fair = calculateDealScore(50, 60, 'As-Is / For Parts', 'Unknown');
  assert.ok(fair.score < 50, `Fair score should be < 50, got ${fair.score}`);
  assert.strictEqual(fair.tier, 'FAIR');
  assert.strictEqual(fair.badgeClass, 'deal-fair');
});

