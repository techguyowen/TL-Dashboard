const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { calculateFinancials } = require('../server.js');

// Load calcFin dynamically from public/js/config.js
const configPath = path.join(__dirname, '../public/js/config.js');
const configContent = fs.readFileSync(configPath, 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(configContent, context);
const calcFin = context.calcFin;

test('Financial Edge Cases: $0.01, $1.99, $100.00, $999.99 exact cent rounding match across server.js and public/js/config.js', () => {
  const cases = [
    {
      bid: 0.01,
      retail: 1.00,
      expected: {
        currentBid: '0.01',
        buyerPremium: '0.00',
        lotFee: '1.00',
        subtotal: '1.01',
        salesTax: '0.07',
        ccFee: '0.03',
        totalCost: '1.11',
        totalCostNum: 1.11
      }
    },
    {
      bid: 1.99,
      retail: 10.00,
      expected: {
        currentBid: '1.99',
        buyerPremium: '0.30',
        lotFee: '1.00',
        subtotal: '3.29',
        salesTax: '0.24',
        ccFee: '0.11',
        totalCost: '3.64',
        totalCostNum: 3.64
      }
    },
    {
      bid: 100.00,
      retail: 200.00,
      expected: {
        currentBid: '100.00',
        buyerPremium: '15.00',
        lotFee: '1.00',
        subtotal: '116.00',
        salesTax: '8.41',
        ccFee: '3.73',
        totalCost: '128.14',
        totalCostNum: 128.14
      }
    },
    {
      bid: 999.99,
      retail: 2000.00,
      expected: {
        currentBid: '999.99',
        buyerPremium: '150.00',
        lotFee: '1.00',
        subtotal: '1150.99',
        salesTax: '83.45',
        ccFee: '37.03',
        totalCost: '1271.47',
        totalCostNum: 1271.47
      }
    }
  ];

  for (const tc of cases) {
    const serverRes = calculateFinancials(tc.bid, tc.retail);
    const clientRes = calcFin(tc.bid, tc.retail);

    // Verify Server calculations against exact step-by-step cent rounding expected values
    assert.strictEqual(serverRes.currentBid, tc.expected.currentBid, `Server currentBid mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.buyerPremium, tc.expected.buyerPremium, `Server buyerPremium mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.lotFee, tc.expected.lotFee, `Server lotFee mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.subtotal, tc.expected.subtotal, `Server subtotal mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.salesTax, tc.expected.salesTax, `Server salesTax mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.ccFee, tc.expected.ccFee, `Server ccFee mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.totalCost, tc.expected.totalCost, `Server totalCost mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.totalCostNum, tc.expected.totalCostNum, `Server totalCostNum mismatch for $${tc.bid}`);

    // Verify Client calculations against exact step-by-step cent rounding expected values
    assert.strictEqual(clientRes.bidFormatted, `$${tc.expected.currentBid}`, `Client bid mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.bpAmount, `$${tc.expected.buyerPremium}`, `Client bp mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.lotFeeAmount, `$${tc.expected.lotFee}`, `Client lotFee mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.taxAmount, `$${tc.expected.salesTax}`, `Client tax mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.ccAmount, `$${tc.expected.ccFee}`, `Client cc mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.totalCost, `$${tc.expected.totalCost}`, `Client total mismatch for $${tc.bid}`);
    assert.strictEqual(clientRes.totalNum, tc.expected.totalCostNum, `Client totalNum mismatch for $${tc.bid}`);

    // Verify exact parity between Server and Client outputs
    assert.strictEqual(`$${serverRes.currentBid}`, clientRes.bidFormatted, `Parity bid mismatch for $${tc.bid}`);
    assert.strictEqual(`$${serverRes.buyerPremium}`, clientRes.bpAmount, `Parity buyerPremium mismatch for $${tc.bid}`);
    assert.strictEqual(`$${serverRes.lotFee}`, clientRes.lotFeeAmount, `Parity lotFee mismatch for $${tc.bid}`);
    assert.strictEqual(`$${serverRes.salesTax}`, clientRes.taxAmount, `Parity salesTax mismatch for $${tc.bid}`);
    assert.strictEqual(`$${serverRes.ccFee}`, clientRes.ccAmount, `Parity ccFee mismatch for $${tc.bid}`);
    assert.strictEqual(`$${serverRes.totalCost}`, clientRes.totalCost, `Parity totalCost mismatch for $${tc.bid}`);
    assert.strictEqual(serverRes.totalCostNum, clientRes.totalNum, `Parity totalCostNum mismatch for $${tc.bid}`);
    assert.strictEqual(String(serverRes.savingsPct), String(clientRes.savingsPct), `Parity savingsPct mismatch for $${tc.bid}`);
  }
});
