const test = require('node:test');
const assert = require('node:assert');
const { calculateFinancials } = require('../server.js');

test('Financials: calculateFinancials calculates fees correctly for $100 bid', () => {
  const result = calculateFinancials(100, 200);

  // Exact step-by-step cent rounding verification
  // Bid: $100.00
  // BP (15%): $15.00
  // Lot Fee: $1.00
  // Subtotal: $116.00
  // Sales Tax (7.25% of $116.00): $8.41
  // CC Fee (3% of $124.41): $3.73
  // Total Cost: $128.14
  assert.strictEqual(result.currentBid, '100.00');
  assert.strictEqual(result.buyerPremium, '15.00');
  assert.strictEqual(result.lotFee, '1.00');
  assert.strictEqual(result.subtotal, '116.00');
  assert.strictEqual(result.salesTax, '8.41');
  assert.strictEqual(result.ccFee, '3.73');
  assert.strictEqual(result.totalCost, '128.14');
  assert.strictEqual(result.totalCostNum, 128.14);
});

test('Financials: step-by-step intermediate cent rounding logic for various bid amounts', () => {
  function computeStepRoundedFees(bid) {
    const b = parseFloat(bid) || 0;
    const bp = Math.round(b * 0.15 * 100) / 100;
    const lot = b > 0 ? 1.00 : 0.00;
    const sub = Math.round((b + bp + lot) * 100) / 100;
    const tax = Math.round(sub * 0.0725 * 100) / 100;
    const cc = Math.round(((sub + tax) * 0.03) * 100) / 100;
    const total = Math.round((sub + tax + cc) * 100) / 100;
    return { b, bp, lot, sub, tax, cc, total };
  }

  // Test $50 bid
  const res50 = computeStepRoundedFees(50);
  assert.strictEqual(res50.bp, 7.50);
  assert.strictEqual(res50.lot, 1.00);
  assert.strictEqual(res50.sub, 58.50);
  assert.strictEqual(res50.tax, 4.24);
  assert.strictEqual(res50.cc, 1.88);
  assert.strictEqual(res50.total, 64.62);

  // Test $100 bid matches server.js function
  const serverRes100 = calculateFinancials(100);
  const stepRes100 = computeStepRoundedFees(100);
  assert.strictEqual(parseFloat(serverRes100.buyerPremium), stepRes100.bp);
  assert.strictEqual(parseFloat(serverRes100.lotFee), stepRes100.lot);
  assert.strictEqual(parseFloat(serverRes100.salesTax), stepRes100.tax);
  assert.strictEqual(parseFloat(serverRes100.ccFee), stepRes100.cc);
  assert.strictEqual(serverRes100.totalCostNum, stepRes100.total);
});
