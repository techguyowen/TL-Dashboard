/**
 * TL Auction Tracker - Deal Score (0-100) Algorithm Engine
 */

const TIER1_BRANDS = new Set([
  'apple', 'sony', 'dewalt', 'milwaukee', 'bose', 'samsung', 'dyson',
  'lg', 'makita', 'kitchenaid', 'le creuset', 'breville', 'yeti', 'sonos'
]);

const TIER2_BRANDS = new Set([
  'ryobi', 'craftsman', 'ridgid', 'ninja', 'instant pot', 'anker',
  'irobot', 'shark', 'cuisinart', 'fitbit', 'garmin', 'dell', 'hp',
  'lenovo', 'asus', 'brother', 'logitech', 'coleman'
]);

/**
 * Calculates algorithmic Deal Score (0 to 100).
 * Combines Savings % (50%), Condition (25%), Brand Tier (15%), and Out-of-Pocket Ratio (10%).
 */
function calculateDealScore(rawBid, rawRetail, rawCondition, rawBrand) {
  const fin = calcFin(rawBid, rawRetail);
  const retail = parseFloat(rawRetail) || 0;
  const currentBid = parseFloat(rawBid) || 0;
  const totalCost = fin.totalNum || 0;

  // 1. Savings Score (50 pts max)
  let savingsScore = 0;
  if (retail > 0 && totalCost > 0) {
    const savingsPct = Math.max(0, ((retail - totalCost) / retail) * 100);
    savingsScore = Math.min(50, Math.round((savingsPct / 100) * 50));
  } else if (retail > 0 && currentBid === 0) {
    savingsScore = 48; // $0 starting bid on high retail
  } else {
    savingsScore = 15; // Unknown retail default
  }

  // 2. Condition Multiplier (25 pts max)
  let conditionScore = 15;
  const cond = String(rawCondition || '').toLowerCase();
  if (cond.includes('new') && !cond.includes('like')) {
    conditionScore = 25;
  } else if (cond.includes('like new') || cond.includes('open box')) {
    conditionScore = 20;
  } else if (cond.includes('used') || cond.includes('refurb')) {
    conditionScore = 12;
  } else if (cond.includes('as-is') || cond.includes('parts') || cond.includes('salvage')) {
    conditionScore = 5;
  }

  // 3. Brand Tier (15 pts max)
  let brandScore = 5;
  const brand = String(rawBrand || '').toLowerCase().trim();
  if (brand) {
    if (TIER1_BRANDS.has(brand)) {
      brandScore = 15;
    } else if (TIER2_BRANDS.has(brand)) {
      brandScore = 10;
    }
  }

  // 4. Out-of-Pocket Absolute Ratio (10 pts max)
  let ratioScore = 0;
  if (totalCost > 0 && retail > 0) {
    const ratio = totalCost / retail;
    if (ratio <= 0.15) ratioScore = 10;
    else if (ratio <= 0.30) ratioScore = 8;
    else if (ratio <= 0.50) ratioScore = 5;
    else if (ratio <= 0.70) ratioScore = 2;
    else ratioScore = 0;
  } else if (currentBid === 0) {
    ratioScore = 10;
  }

  const finalScore = Math.max(0, Math.min(100, savingsScore + conditionScore + brandScore + ratioScore));

  let tier = 'FAIR';
  let badgeClass = 'deal-fair';

  if (finalScore >= 90) {
    tier = 'EPIC STEAL';
    badgeClass = 'deal-epic';
  } else if (finalScore >= 80) {
    tier = 'GREAT DEAL';
    badgeClass = 'deal-great';
  } else if (finalScore >= 65) {
    tier = 'GOOD VALUE';
    badgeClass = 'deal-good';
  }

  return {
    score: finalScore,
    tier,
    badgeClass,
    savingsScore,
    conditionScore,
    brandScore,
    ratioScore
  };
}
