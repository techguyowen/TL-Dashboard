const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { calculateFinancials } = require('../server.js');

// Extract calcFin dynamically from public/index.html for client-side comparison
const htmlPath = path.join(__dirname, '../public/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const startIndex = htmlContent.indexOf('function calcFin(bid, retail) {');
const endIndex = htmlContent.indexOf('function isWatchlistMatch(title)');

if (startIndex === -1 || endIndex === -1) {
  throw new Error('Could not find calcFin in public/index.html');
}

const calcFinCode = htmlContent.slice(startIndex, endIndex).trim();
const calcFin = eval('(' + calcFinCode + ')');

test('Financial Edge Cases: $0.01, $1.99, $100.00, $999.99 exact cent rounding match across server.js and public/index.html', () => {
  const cases = [
    {
      bid: 0.01,
      retail: 1.00,
      expected: {
        currentBid: '0.01',
        buyerPremium: '0.00',
        subtotal: '0.01',
        salesTax: '0.00',
        ccFee: '0.00',
        totalCost: '0.01',
        totalCostNum: 0.01
      }
    },
    {
      bid: 1.99,
      retail: 10.00,
      expected: {
        currentBid: '1.99',
        buyerPremium: '0.30',
        subtotal: '2.29',
        salesTax: '0.17',
        ccFee: '0.07',
        totalCost: '2.53',
        totalCostNum: 2.53
      }
    },
    {
      bid: 100.00,
      retail: 200.00,
      expected: {
        currentBid: '100.00',
        buyerPremium: '15.00',
        subtotal: '115.00',
        salesTax: '8.34',
        ccFee: '3.70',
        totalCost: '127.04',
        totalCostNum: 127.04
      }
    },
    {
      bid: 999.99,
      retail: 2000.00,
      expected: {
        currentBid: '999.99',
        buyerPremium: '150.00',
        subtotal: '1149.99',
        salesTax: '83.37',
        ccFee: '37.00',
        totalCost: '1270.36',
        totalCostNum: 1270.36
      }
    }
  ];

  for (const tc of cases) {
    const serverRes = calculateFinancials(tc.bid, tc.retail);
    const clientRes = calcFin(tc.bid, tc.retail);

    // Verify Server calculations against exact step-by-step cent rounding expected values
    assert.strictEqual(serverRes.currentBid, tc.expected.currentBid, `Server currentBid mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.buyerPremium, tc.expected.buyerPremium, `Server buyerPremium mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.subtotal, tc.expected.subtotal, `Server subtotal mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.salesTax, tc.expected.salesTax, `Server salesTax mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.ccFee, tc.expected.ccFee, `Server ccFee mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.totalCost, tc.expected.totalCost, `Server totalCost mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.totalCostNum, tc.expected.totalCostNum, `Server totalCostNum mismatch for $${tc.bid}`);

    // Verify Client calculations against exact step-by-step cent rounding expected values
    assert.strictEqual(clientRes.bid, tc.expected.currentBid, `Client bid mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.bp, tc.expected.buyerPremium, `Client bp mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.sub, tc.expected.subtotal, `Client sub mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.tax, tc.expected.salesTax, `Client tax mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.cc, tc.expected.ccFee, `Client cc mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.total, tc.expected.totalCost, `Client total mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.totalNum, tc.expected.totalCostNum, `Client totalNum mismatch for $${tc.bid}`);

    // Verify exact parity between Server and Client outputs
    assert.strictEqual(serverRes.currentBid, clientRes.bid, `Parity bid mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.buyerPremium, clientRes.bp, `Parity buyerPremium mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.subtotal, clientRes.sub, `Parity subtotal mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.salesTax, clientRes.tax, `Parity salesTax mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.ccFee, clientRes.cc, `Parity ccFee mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.totalCost, clientRes.total, `Parity totalCost mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.totalCostNum, clientRes.totalNum, `Parity totalCostNum mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.savingsPct, clientRes.savingsPct, `Parity savingsPct mismatch for $${tc.bid}`);
  }
});
