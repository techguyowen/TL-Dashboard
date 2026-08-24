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

test('Financial Equivalence: 1,000 bid values from $0 to $10,000 ($10 step size)', () => {
  let matchedCount = 0;
  const count = 1000;
  const step = 10000 / (count - 1); // 1000 values from 0.00 to 10000.00

  for (let i = 0; i < count; i++) {
    const bidVal = parseFloat((i * step).toFixed(2));
    const retailVal = parseFloat((bidVal * 2).toFixed(2));

    const backendRes = calculateFinancials(bidVal, retailVal);
    const frontendRes = calcFin(bidVal, retailVal);

    if (bidVal > 0) {
      assert.strictEqual(`$${backendRes.currentBid}`, frontendRes.bidFormatted, `Mismatch in bid for value ${bidVal}`);
      assert.strictEqual(`$${backendRes.buyerPremium}`, frontendRes.bpAmount, `Mismatch in buyerPremium for bid ${bidVal}`);
      assert.strictEqual(`$${backendRes.lotFee}`, frontendRes.lotFeeAmount, `Mismatch in lotFee for bid ${bidVal}`);
      assert.strictEqual(`$${backendRes.salesTax}`, frontendRes.taxAmount, `Mismatch in salesTax for bid ${bidVal}`);
      assert.strictEqual(`$${backendRes.ccFee}`, frontendRes.ccAmount, `Mismatch in ccFee for bid ${bidVal}`);
      assert.strictEqual(`$${backendRes.totalCost}`, frontendRes.totalCost, `Mismatch in totalCost for bid ${bidVal}`);
      assert.strictEqual(backendRes.totalCostNum, frontendRes.totalNum, `Mismatch in totalCostNum for bid ${bidVal}`);
      assert.strictEqual(String(backendRes.savingsPct), String(frontendRes.savingsPct), `Mismatch in savingsPct for bid ${bidVal}`);
    }

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

    if (bidVal > 0) {
      assert.strictEqual(`$${backendRes.currentBid}`, frontendRes.bidFormatted);
      assert.strictEqual(`$${backendRes.buyerPremium}`, frontendRes.bpAmount);
      assert.strictEqual(`$${backendRes.lotFee}`, frontendRes.lotFeeAmount);
      assert.strictEqual(`$${backendRes.salesTax}`, frontendRes.taxAmount);
      assert.strictEqual(`$${backendRes.ccFee}`, frontendRes.ccAmount);
      assert.strictEqual(`$${backendRes.totalCost}`, frontendRes.totalCost);
      assert.strictEqual(backendRes.totalCostNum, frontendRes.totalNum);
      assert.strictEqual(String(backendRes.savingsPct), String(frontendRes.savingsPct));
    }

    matchedCount++;
  }

  assert.strictEqual(matchedCount, 1000, 'Expected 1,000 cent increment checks to pass');
});
