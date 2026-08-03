const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '../server.js');
const INDEX_PATH = path.resolve(__dirname, '../public/index.html');

test('Expiration Buffer & Timezone: server.js uses America/New_York timezone helper and 11:59 PM EDT', () => {
  const content = fs.readFileSync(SERVER_PATH, 'utf8');

  assert.strictEqual(
    content.includes('function getEDTDateString'),
    true,
    'server.js must define getEDTDateString helper to prevent UTC rollover bugs'
  );
  assert.strictEqual(
    content.includes("timeZone: 'America/New_York'"),
    true,
    'server.js must use America/New_York timezone for local date construction'
  );
  assert.strictEqual(
    content.includes('T23:59:59-04:00'),
    true,
    'server.js must default closing date timestamps to T23:59:59-04:00'
  );
  assert.strictEqual(
    content.includes('REMOVAL_BUFFER_MS = 2 * 60 * 60 * 1000'),
    true,
    'server.js pruneExpiredCatalogCache must include a 2-hour removal buffer'
  );
});

test('Expiration Buffer: public/index.html uses 23:59:59-04:00 (11:59 PM EDT) and grace buffer', () => {
  const content = fs.readFileSync(INDEX_PATH, 'utf8');

  assert.strictEqual(
    content.includes('T23:59:59-04:00'),
    true,
    'public/index.html formatTimeRemaining must use T23:59:59-04:00 as target date'
  );
  assert.strictEqual(
    content.includes('BUFFER_MS = 2 * 60 * 60 * 1000'),
    true,
    'public/index.html autoCleanEndedFavorites must use a 2-hour removal buffer'
  );
});

test('Timezone logic: verifies evening EDT date construction does not roll over to next day UTC', () => {
  // Simulate 8:30 PM EDT (00:30 UTC next day)
  const eveningEDT = new Date('2026-08-02T20:30:00-04:00');
  const edtDateStr = eveningEDT.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const utcDateStr = eveningEDT.toISOString().split('T')[0];

  assert.strictEqual(edtDateStr, '2026-08-02', 'EDT date must remain 2026-08-02 at 8:30 PM EDT');
  assert.strictEqual(utcDateStr, '2026-08-03', 'Raw UTC toISOString rolls over to 2026-08-03');
});
