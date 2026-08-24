/**
 * TL Auction Tracker - Global Configuration & Financial Helpers
 */

const DEFAULT_TAX_RATE = 0.0725; // 7.25% NC/SC avg sales tax
const BUYER_PREMIUM = 0.15;      // 15% Buyer's Premium
const CC_FEE = 0.03;             // 3% Credit Card / Processing Fee
const PAGE_CHUNK_SIZE = 96;

/**
 * Escapes HTML characters to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Calculates out-of-pocket costs, fees, and percentage savings.
 */
function calcFin(rawBid, rawRetail) {
  const bid = parseFloat(rawBid) || 0;
  const retail = parseFloat(rawRetail) || 0;

  if (bid <= 0) {
    return {
      bidFormatted: '$0.00',
      retailFormatted: retail > 0 ? `$${retail.toFixed(2)}` : '$0.00',
      bpAmount: '$0.00',
      taxAmount: '$0.00',
      ccAmount: '$0.00',
      totalCost: '$0.00',
      totalNum: 0,
      savingsPct: retail > 0 ? '100' : null,
      savingsAmount: retail > 0 ? `$${retail.toFixed(2)}` : null,
      isDeal: retail > 0
    };
  }

  const bp = bid * BUYER_PREMIUM;
  const tax = (bid + bp) * DEFAULT_TAX_RATE;
  const cc = (bid + bp + tax) * CC_FEE;
  const total = bid + bp + tax + cc;

  let savingsPct = null;
  let savingsAmount = null;
  let isDeal = false;

  if (retail > 0) {
    const saved = retail - total;
    if (saved > 0) {
      savingsPct = Math.round((saved / retail) * 100);
      savingsAmount = `$${saved.toFixed(2)}`;
      isDeal = savingsPct >= 40;
    }
  }

  return {
    bidFormatted: `$${bid.toFixed(2)}`,
    retailFormatted: retail > 0 ? `$${retail.toFixed(2)}` : 'N/A',
    bpAmount: `$${bp.toFixed(2)}`,
    taxAmount: `$${tax.toFixed(2)}`,
    ccAmount: `$${cc.toFixed(2)}`,
    totalCost: `$${total.toFixed(2)}`,
    totalNum: total,
    savingsPct: savingsPct !== null ? String(savingsPct) : null,
    savingsAmount,
    isDeal
  };
}

/**
 * Formats time remaining into human-readable text and urgency status classes.
 */
function formatTimeRemaining(endsAt, closingDate) {
  let targetMs = 0;
  if (endsAt) {
    targetMs = new Date(endsAt).getTime();
  } else if (closingDate) {
    targetMs = new Date(closingDate).getTime();
  }

  if (!targetMs || isNaN(targetMs)) {
    return { text: 'Time TBD', statusClass: 'status-upcoming', diffHours: 999 };
  }

  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) {
    return { text: 'Auction Ended', statusClass: 'status-ended', diffHours: 0 };
  }

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  let text = '';
  let statusClass = 'status-upcoming';

  if (diffMinutes < 60) {
    text = `${diffMinutes}m remaining`;
    statusClass = 'status-urgent';
  } else if (diffHours < 24) {
    const remMins = diffMinutes % 60;
    text = `${diffHours}h ${remMins}m remaining`;
    statusClass = diffHours < 6 ? 'status-urgent' : 'status-soon';
  } else {
    const remHours = diffHours % 24;
    text = `${diffDays}d ${remHours}h remaining`;
    statusClass = 'status-upcoming';
  }

  return { text, statusClass, diffHours, diffMinutes };
}
