const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { calculateFinancials } = require('../server.js');

// Extract calcFin dynamically from public/index.html to ensure 100% authentic parity testing
const htmlPath = path.join(__dirname, '../public/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const startIndex = htmlContent.indexOf('function calcFin(bid, retail) {');
const endIndex = htmlContent.indexOf('function isWatchlistMatch(title)');

if (startIndex === -1 || endIndex === -1) {
  throw new Error('Could not slice calcFin function definition from public/index.html');
}

const calcFinCode = htmlContent.slice(startIndex, endIndex).trim();

// Evaluate function expression to get calcFin
const calcFin = eval('(' + calcFinCode + ')');

test('Financial Equivalence: 1,000 bid values from $0 to $10,000 ($10 step size)', () => {
  let matchedCount = 0;
  const count = 1000;
  const step = 10000 / (count - 1); // 1000 values from 0.00 to 10000.00

  for (let i = 0; i < count; i++) {
    const bidVal = parseFloat((i * step).toFixed(2));
    const retailVal = parseFloat((bidVal * 2).toFixed(2));

    const backendRes = calculateFinancials(bidVal, retailVal);
    const frontendRes = calcFin(bidVal, retailVal);

    assert.strictEqual(backendRes.currentBid, frontendRes.bid, `Mismatch in bid for value ${bidVal}`);
    assert.strictEqual(backendRes.buyerPremium, frontendRes.bp, `Mismatch in buyerPremium for bid ${bidVal}`);
    assert.strictEqual(backendRes.subtotal, frontendRes.sub, `Mismatch in subtotal for bid ${bidVal}`);
    assert.strictEqual(backendRes.salesTax, frontendRes.tax, `Mismatch in salesTax for bid ${bidVal}`);
    assert.strictEqual(backendRes.ccFee, frontendRes.cc, `Mismatch in ccFee for bid ${bidVal}`);
    assert.strictEqual(backendRes.totalCost, frontendRes.total, `Mismatch in totalCost for bid ${bidVal}`);
    assert.strictEqual(backendRes.totalCostNum, frontendRes.totalNum, `Mismatch in totalCostNum for bid ${bidVal}`);
    assert.strictEqual(backendRes.retailPrice, frontendRes.retailPrice, `Mismatch in retailPrice for bid ${bidVal}`);
    assert.strictEqual(backendRes.savingsPct, frontendRes.savingsPct, `Mismatch in savingsPct for bid ${bidVal}`);

    matchedCount++;
  }

  assert.strictEqual(matchedCount, 1000, 'Expected 1,000 bid values to pass equivalence check');
});

test('Financial Equivalence: First 1,000 cent increments ($0.00 to $9.99 in $0.01 increments)', () => {
  let matchedCount = 0;
  for (let i = 0; i < 1000; i++) {
    const bidVal = parseFloat((i * 0.01).toFixed(2));
    const retailVal = parseFloat((bidVal * 1.5).toFixed(2));

    const backendRes = calculateFinancials(bidVal, retailVal);
    const frontendRes = calcFin(bidVal, retailVal);

    assert.strictEqual(backendRes.currentBid, frontendRes.bid);
    assert.strictEqual(backendRes.buyerPremium, frontendRes.bp);
    assert.strictEqual(backendRes.subtotal, frontendRes.sub);
    assert.strictEqual(backendRes.salesTax, frontendRes.tax);
    assert.strictEqual(backendRes.ccFee, frontendRes.cc);
    assert.strictEqual(backendRes.totalCost, frontendRes.total);
    assert.strictEqual(backendRes.totalCostNum, frontendRes.totalNum);
    assert.strictEqual(backendRes.retailPrice, frontendRes.retailPrice);
    assert.strictEqual(backendRes.savingsPct, frontendRes.savingsPct);

    matchedCount++;
  }

  assert.strictEqual(matchedCount, 1000);
});
