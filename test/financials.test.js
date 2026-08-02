const test = require('node:test');
const assert = require('node:assert');
const { calculateFinancials } = require('../server.js');

test('Financials: calculateFinancials calculates fees correctly for $100 bid', () => {
  const result = calculateFinancials(100, 200);

  // Exact step-by-step cent rounding verification
  // Bid: $100.00
  // BP (15%): $15.00
  // Subtotal: $115.00
  // Sales Tax (7.25% of $115.00): $8.3375 -> $8.34
  // CC Fee (3% of $123.34): $3.7002 -> $3.70
  // Total Cost: $127.04
  assert.strictEqual(result.currentBid, '100.00');
  assert.strictEqual(result.buyerPremium, '15.00');
  assert.strictEqual(result.subtotal, '115.00');
  assert.strictEqual(result.salesTax, '8.34');
  assert.strictEqual(result.ccFee, '3.70');
  assert.strictEqual(result.totalCost, '127.04');
  assert.strictEqual(result.totalCostNum, 127.04);
});

test('Financials: step-by-step intermediate cent rounding logic for various bid amounts', () => {
  function computeStepRoundedFees(bid) {
    const b = parseFloat(bid) || 0;
    const bp = Math.round(b * 0.15 * 100) / 100;
    const sub = Math.round((b + bp) * 100) / 100;
    const tax = Math.round(sub * 0.0725 * 100) / 100;
    const cc = Math.round((sub + tax) * 0.03 * 100) / 100;
    const total = Math.round((sub + tax + cc) * 100) / 100;
    return { b, bp, sub, tax, cc, total };
  }

  // Test $50 bid
  const res50 = computeStepRoundedFees(50);
  assert.strictEqual(res50.bp, 7.50);
  assert.strictEqual(res50.sub, 57.50);
  assert.strictEqual(res50.tax, 4.17);
  assert.strictEqual(res50.cc, 1.85);
  assert.strictEqual(res50.total, 63.52);

  // Test $100 bid matches server.js function
  const serverRes100 = calculateFinancials(100);
  const stepRes100 = computeStepRoundedFees(100);
  assert.strictEqual(parseFloat(serverRes100.buyerPremium), stepRes100.bp);
  assert.strictEqual(parseFloat(serverRes100.salesTax), stepRes100.tax);
  assert.strictEqual(parseFloat(serverRes100.ccFee), stepRes100.cc);
  assert.strictEqual(serverRes100.totalCostNum, stepRes100.total);
});
