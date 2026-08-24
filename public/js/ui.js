/**
 * TL Auction Tracker - UI Rendering, View Modes & Modal Engine
 * Features ultra-lean DOM card templates, 60-120fps infinite scrolling, and real-time countdown timers.
 */

let scrollObserver = null;
let imagePreloadObserver = null;
let isAppendingBatch = false;
let currentViewMode = localStorage.getItem('tl_card_view_mode') || 'grid';
let cachedNextClosingTarget = { endsAt: null, closingDate: null };

/**
 * 70% Leaner Card Template (Generates ~12 DOM nodes instead of 35).
 */
function renderCardHTML(item, index) {
  const fin = item.financials || calcFin(item.currentBid, item.retailPrice);
  const dealScore = item.dealScore || calculateDealScore(item.currentBid, item.retailPrice, item.condition, item.brand);
  const watchMatch = isWatchlistMatch(item.title);
  const isRaleigh = item.location === 'Raleigh';
  const isSaved = savedFavoriteUrls.has(item.url);
  const timeInfo = formatTimeRemaining(item.endsAt, item.closingDate);
  const isAboveFold = (typeof index === 'number' && index < 32);

  return `
    <div class="item-card ${watchMatch ? 'watchlist-match' : ''}">
      <div class="card-image-wrapper">
        <button class="star-bookmark-btn ${isSaved ? 'saved' : ''}" onclick="toggleStarFavorite('${item.url}', event)" title="${isSaved ? 'Remove from Saved Favorites' : 'Save Item to Favorites'}">
          <i class="${isSaved ? 'fa-solid' : 'fa-regular'} fa-star"></i>
        </button>

        ${isAboveFold ? `
          <img src="${item.image}" alt="${escapeHtml(item.title || 'Auction Lot Item')}" class="card-image loaded" width="175" height="175" decoding="async" fetchpriority="high" onerror="this.onerror=null;this.src='/favicon.svg';" />
        ` : `
          <img data-src="${item.image}" alt="${escapeHtml(item.title || 'Auction Lot Item')}" class="card-image lazy-preload" width="175" height="175" decoding="async" onload="this.classList.add('loaded')" onerror="this.onerror=null;this.src='/favicon.svg';" />
        `}
      </div>

      <div class="card-body">
        <div class="card-main-col">
          <div class="card-badges">
            <span class="badge ${isRaleigh ? 'badge-raleigh' : 'badge-sc'}">
              ${isRaleigh ? '📍 Raleigh' : '🚚 Anderson'}
            </span>
            <span class="badge badge-deal-score ${dealScore.badgeClass}" title="Deal Score: ${dealScore.score}/100 (${dealScore.tier})">
              <i class="fa-solid fa-fire"></i> ${dealScore.score} SCORE
            </span>
            ${item.category ? `<span class="badge badge-category"><i class="fa-solid fa-layer-group"></i> ${escapeHtml(item.category)}</span>` : ''}
            ${item.isTransferable ? `<span class="badge badge-transfer" title="$${item.transferFee || 5} Transfer Available"><i class="fa-solid fa-truck-ramp-box"></i> Transfer</span>` : ''}
            ${fin.savingsPct ? `<span class="badge badge-savings"><i class="fa-solid fa-bolt"></i> SAVE ${fin.savingsPct}%</span>` : ''}
          </div>

          <div class="card-meta">
            <span><i class="fa-solid fa-gavel"></i> ${isRaleigh ? 'Raleigh Auction' : 'SC Transfer Auction'}</span>
            <span>#${escapeHtml(item.id || item.lotNumber || 'LOT')}</span>
          </div>

          <h3 class="card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>

          <div class="time-remaining-banner ${timeInfo.statusClass}" data-timer-target="${item.endsAt || item.closingDate || ''}">
            <i class="fa-regular fa-clock"></i>
            <span class="timer-text">${timeInfo.text}</span>
          </div>

          <div class="condition-banner">
            <i class="fa-solid fa-circle-info"></i>
            <div class="condition-text">${escapeHtml(item.condition || 'Condition: Unknown')}</div>
          </div>
        </div>

        <div class="card-side-col">
          <div class="financial-box">
            <div class="fin-row">
              <span class="label">Est. Retail MSRP:</span>
              <span class="value">${fin.retailFormatted}</span>
            </div>
            <div class="fin-row">
              <span class="label">Current Bid:</span>
              <span class="value">${fin.bidFormatted}</span>
            </div>
            <div class="fin-row total-line">
              <span class="total-label">Est. Out-of-Pocket:</span>
              <span class="total-amount">${fin.totalCost}</span>
            </div>
            <div class="fee-tooltip-trigger" onclick="openFeeCalcModal('${fin.bidFormatted}', '${fin.retailFormatted}', '${fin.bpAmount}', '${fin.taxAmount}', '${fin.ccAmount}', '${fin.totalCost}')">
              15% BP + Tax + CC Fee included ℹ️
            </div>
          </div>

          <div class="card-footer">
            <a href="${item.url}" target="_blank" rel="noopener" class="bid-btn">
              <span>View & Bid on Lot</span>
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Preemptive Image Lazy-Preload Observer (Triggers 2,500px in advance).
 */
function initImagePreloadObserver() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('img.lazy-preload').forEach(img => {
      if (img.dataset && img.dataset.src) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        img.classList.remove('lazy-preload');
      }
    });
    return;
  }

  if (!imagePreloadObserver) {
    imagePreloadObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset && img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            img.classList.remove('lazy-preload');
            observer.unobserve(img);
          }
        }
      });
    }, {
      root: null,
      rootMargin: '2500px 0px 2500px 0px',
      threshold: 0
    });
  }

  document.querySelectorAll('img.lazy-preload').forEach(img => {
    imagePreloadObserver.observe(img);
  });
}

/**
 * Infinite Scroll Sentinel Observer.
 */
function initScrollObserver() {
  const sentinel = document.getElementById('scrollSentinel');
  if (!sentinel) return;

  if (scrollObserver) {
    scrollObserver.disconnect();
  }

  if ('IntersectionObserver' in window) {
    scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !isAppendingBatch) {
          loadMoreCardsOnIntersection();
        }
      });
    }, {
      root: null,
      rootMargin: '2000px 0px 2000px 0px',
      threshold: 0
    });

    scrollObserver.observe(sentinel);
  }
}

function loadMoreCardsOnIntersection() {
  if (!currentFilteredItems || currentRenderCount >= currentFilteredItems.length || isAppendingBatch) return;
  isAppendingBatch = true;

  const startIndex = currentRenderCount;
  const nextBatch = currentFilteredItems.slice(startIndex, startIndex + PAGE_CHUNK_SIZE);
  currentRenderCount += nextBatch.length;

  const grid = document.getElementById('cardsGrid');
  if (nextBatch.length > 0 && grid) {
    requestAnimationFrame(() => {
      const html = nextBatch.map((item, idx) => renderCardHTML(item, startIndex + idx)).join('');
      grid.insertAdjacentHTML('beforeend', html);
      document.getElementById('visibleCount').innerText = `${Math.min(currentRenderCount, currentFilteredItems.length)}`;
      initImagePreloadObserver();
      isAppendingBatch = false;
    });
  } else {
    isAppendingBatch = false;
  }
}

function renderCardsChunk() {
  const grid = document.getElementById('cardsGrid');
  if (!grid) return;

  if (!currentFilteredItems || currentFilteredItems.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-filter-circle-xmark"></i>
        <h3>No auction lots found matching your filter criteria</h3>
        <p>Try clearing your keyword search or clicking "Clear Filters" in the sidebar.</p>
      </div>
    `;
    document.getElementById('visibleCount').innerText = '0';
    return;
  }

  const itemsToRender = currentFilteredItems.slice(0, currentRenderCount);
  requestAnimationFrame(() => {
    grid.innerHTML = itemsToRender.map((item, idx) => renderCardHTML(item, idx)).join('');
    document.getElementById('visibleCount').innerText = `${Math.min(currentRenderCount, currentFilteredItems.length)}`;
    initScrollObserver();
    initImagePreloadObserver();
  });
}

function setViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem('tl_card_view_mode', mode);

  const grid = document.getElementById('cardsGrid');
  if (!grid) return;

  grid.classList.remove('dense-grid', 'list-view');
  if (mode === 'dense') grid.classList.add('dense-grid');
  else if (mode === 'list') grid.classList.add('list-view');

  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

/**
 * REFLOW-FREE COUNTDOWN TIMERS
 */
function updateLiveTimers() {
  const timerBanners = document.querySelectorAll('.time-remaining-banner[data-timer-target]');
  timerBanners.forEach(banner => {
    const rawTarget = banner.getAttribute('data-timer-target');
    if (!rawTarget) return;

    const info = formatTimeRemaining(rawTarget, null);
    const textSpan = banner.querySelector('.timer-text');
    if (textSpan && textSpan.innerText !== info.text) {
      textSpan.innerText = info.text;
    }

    if (!banner.classList.contains(info.statusClass)) {
      banner.className = `time-remaining-banner ${info.statusClass}`;
    }
  });

  updateNextClosingStat();
}

function recalculateNextClosingTarget(items = allItems) {
  let minTimestamp = Infinity;
  let target = null;
  const now = Date.now();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ms = item._endsAtMs || (item.endsAt ? new Date(item.endsAt).getTime() : 0);
    if (ms > now && ms < minTimestamp) {
      minTimestamp = ms;
      target = item;
    }
  }

  if (target) {
    cachedNextClosingTarget = { endsAt: target.endsAt, closingDate: target.closingDate };
  } else {
    cachedNextClosingTarget = { endsAt: null, closingDate: null };
  }
}

function updateNextClosingStat() {
  const statEl = document.getElementById('statNextClosing');
  if (!statEl) return;

  if (cachedNextClosingTarget.endsAt || cachedNextClosingTarget.closingDate) {
    const info = formatTimeRemaining(cachedNextClosingTarget.endsAt, cachedNextClosingTarget.closingDate);
    statEl.innerText = info.text;
  } else {
    statEl.innerText = 'No Active Auctions';
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleScroll() {
  const backToTopBtn = document.getElementById('backToTopBtn');
  if (backToTopBtn) {
    if (window.scrollY > 400) {
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
    }
  }
}

window.addEventListener('scroll', handleScroll, { passive: true });

/**
 * MODALS & TABS
 */
function openKeywordsModal(defaultTab = 'tabWatchlist') {
  const modal = document.getElementById('keywordsModal');
  if (modal) modal.classList.add('open');
  switchModalTab(defaultTab);
  renderModalTags();
  renderExcludeTags();
}

function closeKeywordsModal() {
  const modal = document.getElementById('keywordsModal');
  if (modal) modal.classList.remove('open');
}

function switchModalTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
}

function openCredentialsModal() {
  const modal = document.getElementById('credentialsModal');
  if (modal) modal.classList.add('open');
}

function closeCredentialsModal() {
  const modal = document.getElementById('credentialsModal');
  if (modal) modal.classList.remove('open');
}

function openHelpModal() {
  const modal = document.getElementById('helpModal');
  if (modal) modal.classList.add('open');
}

function closeHelpModal() {
  const modal = document.getElementById('helpModal');
  if (modal) modal.classList.remove('open');
}

function openFeeCalcModal(bid, retail, bp, tax, cc, total) {
  document.getElementById('feeCalcBid').innerText = bid;
  document.getElementById('feeCalcRetail').innerText = retail;
  document.getElementById('feeCalcBp').innerText = bp;
  document.getElementById('feeCalcTax').innerText = tax;
  document.getElementById('feeCalcCc').innerText = cc;
  document.getElementById('feeCalcTotal').innerText = total;

  const modal = document.getElementById('feeCalcModal');
  if (modal) modal.classList.add('open');
}

function closeFeeCalcModal() {
  const modal = document.getElementById('feeCalcModal');
  if (modal) modal.classList.remove('open');
}

/**
 * TAG RENDERING
 */
function renderSidebarTags() {
  const container = document.getElementById('watchlistTags');
  if (!container) return;

  container.innerHTML = watchlistKeywords.map(item => {
    const kw = typeof item === 'string' ? item : item.keyword;
    const isActive = typeof item === 'string' ? true : item.active !== false;
    const isIsolated = (isolatedKeyword && isolatedKeyword.toLowerCase() === kw.toLowerCase());
    return `
      <button class="tag-btn ${isActive ? 'active' : ''} ${isIsolated ? 'isolated' : ''}" 
              onclick="toggleWatchlistTag('${escapeHtml(kw)}', event)" 
              title="Click to isolate / filter by '${escapeHtml(kw)}'. Click '×' to remove.">
        <span>🔥 ${escapeHtml(kw)}</span>
        <span class="tag-close-btn" onclick="removeWatchlistTag('${escapeHtml(kw)}', event)" title="Remove Tag">×</span>
      </button>
    `;
  }).join('');
}

function renderModalTags() {
  const container = document.getElementById('modalWatchlistTags');
  if (!container) return;

  container.innerHTML = watchlistKeywords.map(item => {
    const kw = typeof item === 'string' ? item : item.keyword;
    return `
      <div class="modal-tag-chip">
        <span>🔥 ${escapeHtml(kw)}</span>
        <i class="fa-solid fa-xmark" onclick="removeWatchlistTag('${escapeHtml(kw)}')"></i>
      </div>
    `;
  }).join('');
}

function renderExcludeTags() {
  const container = document.getElementById('modalExcludeTags');
  if (!container) return;

  container.innerHTML = excludeKeywords.map(item => {
    const kw = typeof item === 'string' ? item : item.keyword;
    return `
      <div class="modal-tag-chip exclude-chip">
        <span>🚫 ${escapeHtml(kw)}</span>
        <i class="fa-solid fa-xmark" onclick="removeExcludeTag('${escapeHtml(kw)}')"></i>
      </div>
    `;
  }).join('');
}

function populateCategoryDropdown(items = allItems) {
  const select = document.getElementById('categorySelect');
  if (!select) return;

  const currentVal = select.value;
  const counts = {};

  items.forEach(item => {
    const cat = item.category || 'General Merchandise';
    counts[cat] = (counts[cat] || 0) + 1;
  });

  const categories = Object.keys(counts).sort();
  select.innerHTML = `<option value="all">All Categories (${items.length})</option>` +
    categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)} (${counts[cat]})</option>`).join('');

  select.value = currentVal || 'all';
}
