/**
 * TL Auction Tracker - Main Application Controller
 * Handles data ingestion, SSE delta synchronization, filtering pipeline, and events.
 */

let allItems = [];
let currentFilteredItems = [];
let currentRenderCount = 96;
let isolatedKeyword = null;
let filterSavedOnly = false;
let filterTopDealsOnly = false;
let lastScrapeTimestamp = 0;
let isFetchingCatalog = false;
let searchDebounceTimer = null;
let progressPollTimer = null;

/**
 * WATCHLIST & EXCLUDE MATCHING
 */
function isWatchlistMatch(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return watchlistKeywords.some(item => {
    const kw = (typeof item === 'string' ? item : item.keyword || '').toLowerCase();
    const isActive = (typeof item === 'string' ? true : item.active !== false);
    return isActive && kw && lower.includes(kw);
  });
}

function isExcludedMatch(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return excludeKeywords.some(item => {
    const kw = (typeof item === 'string' ? item : item.keyword || '').toLowerCase();
    const isActive = (typeof item === 'string' ? true : item.active !== false);
    return isActive && kw && lower.includes(kw);
  });
}

function toggleWatchlistTag(keyword, evt) {
  if (evt && evt.target && (evt.target.classList.contains('tag-close-btn') || evt.target.classList.contains('fa-xmark'))) return;

  if (isolatedKeyword === keyword) {
    clearIsolatedTagFilter();
    return;
  }

  isolatedKeyword = keyword;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = keyword;

  const banner = document.getElementById('isolatedTagBanner');
  const label = document.getElementById('isolatedTagName');
  if (banner && label) {
    label.innerText = keyword;
    banner.style.display = 'flex';
  }

  renderSidebarTags();
  applyFilters();
}

function clearIsolatedTagFilter() {
  isolatedKeyword = null;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  const banner = document.getElementById('isolatedTagBanner');
  if (banner) banner.style.display = 'none';

  renderSidebarTags();
  applyFilters();
}

function removeWatchlistTag(keyword, evt) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }
  watchlistKeywords = watchlistKeywords.filter(k => {
    const kw = typeof k === 'string' ? k : k.keyword;
    return kw.toLowerCase() !== keyword.toLowerCase();
  });
  saveTagsState();
  if (isolatedKeyword && isolatedKeyword.toLowerCase() === keyword.toLowerCase()) {
    isolatedKeyword = null;
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    const banner = document.getElementById('isolatedTagBanner');
    if (banner) banner.style.display = 'none';
  }
  renderSidebarTags();
  renderModalTags();
  applyFilters();
}

function addWatchlistTag() {
  const input = document.getElementById('newTagInput');
  const val = input ? input.value.trim() : '';
  if (!val) return;

  if (!watchlistKeywords.some(k => k.keyword.toLowerCase() === val.toLowerCase())) {
    watchlistKeywords.push({ keyword: val, active: true });
    saveTagsState();
    renderSidebarTags();
    renderModalTags();
    applyFilters();
    playSuccessChime();
  }
  if (input) input.value = '';
}

function addExcludeTag() {
  const input = document.getElementById('newExcludeTagInput');
  const val = input ? input.value.trim() : '';
  if (!val) return;

  if (!excludeKeywords.some(k => (typeof k === 'string' ? k : k.keyword).toLowerCase() === val.toLowerCase())) {
    excludeKeywords.push({ keyword: val, active: true });
    saveExcludeTagsState();
    renderSidebarTags();
    renderExcludeTags();
    applyFilters();
    playSuccessChime();
  }
  if (input) input.value = '';
}

function toggleExcludeTag(keyword, evt) {
  if (evt && evt.target && (evt.target.classList.contains('tag-close-btn') || evt.target.classList.contains('fa-xmark'))) return;

  const target = excludeKeywords.find(k => {
    const kw = typeof k === 'string' ? k : k.keyword;
    return kw.toLowerCase() === keyword.toLowerCase();
  });

  if (target) {
    if (typeof target === 'string') {
      const idx = excludeKeywords.indexOf(target);
      excludeKeywords[idx] = { keyword: target, active: false };
    } else {
      target.active = !target.active;
    }
  } else {
    excludeKeywords.push({ keyword, active: true });
  }

  saveExcludeTagsState();
  renderSidebarTags();
  renderExcludeTags();
  applyFilters();
}

function removeExcludeTag(keyword, evt) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }
  excludeKeywords = excludeKeywords.filter(k => {
    const kw = typeof k === 'string' ? k : k.keyword;
    return kw.toLowerCase() !== keyword.toLowerCase();
  });
  saveExcludeTagsState();
  renderSidebarTags();
  renderExcludeTags();
  applyFilters();
}

/**
 * FAVORITES & DEALS TOGGLES
 */
function toggleStarFavorite(url, evt) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }
  if (savedFavoriteUrls.has(url)) {
    savedFavoriteUrls.delete(url);
  } else {
    savedFavoriteUrls.add(url);
    playSuccessChime();
  }
  saveFavoritesState();
  applyFilters();
}

function toggleSavedFilter() {
  filterSavedOnly = !filterSavedOnly;
  const btn = document.getElementById('filterSavedBtn');
  if (btn) btn.classList.toggle('active', filterSavedOnly);
  applyFilters();
}

function toggleTopDealsFilter() {
  filterTopDealsOnly = !filterTopDealsOnly;
  const btn = document.getElementById('filterTopDealsBtn');
  if (btn) btn.classList.toggle('active', filterTopDealsOnly);
  applyFilters();
}

/**
 * SEARCH & FILTERING ENGINE
 */
function onSearchInputDebounced() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    const rawQuery = document.getElementById('searchInput').value.trim().toLowerCase();
    if (isolatedKeyword && rawQuery !== isolatedKeyword) {
      isolatedKeyword = null;
      const banner = document.getElementById('isolatedTagBanner');
      if (banner) banner.style.display = 'none';
      renderSidebarTags();
    }
    applyFilters();
  }, 150);
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('locationFilter').value = 'all';
  document.getElementById('categorySelect').value = 'all';
  document.getElementById('timeRemainingFilter').value = 'all';
  document.getElementById('maxPriceSlider').value = 500;
  document.getElementById('maxPriceValue').innerText = '$500+';
  document.getElementById('sortSelect').value = userPreferences.defaultSort || 'watchlist';

  isolatedKeyword = null;
  filterSavedOnly = false;
  filterTopDealsOnly = false;

  const favBtn = document.getElementById('filterSavedBtn');
  if (favBtn) favBtn.classList.remove('active');
  const dealsBtn = document.getElementById('filterTopDealsBtn');
  if (dealsBtn) dealsBtn.classList.remove('active');
  const banner = document.getElementById('isolatedTagBanner');
  if (banner) banner.style.display = 'none';

  renderSidebarTags();
  applyFilters();
}

function applyFilters(resetChunkPagination = true) {
  const rawSearch = document.getElementById('searchInput') ? document.getElementById('searchInput').value.trim().toLowerCase() : '';
  const location = document.getElementById('locationFilter') ? document.getElementById('locationFilter').value : 'all';
  const category = document.getElementById('categorySelect') ? document.getElementById('categorySelect').value : 'all';
  const timeFilter = document.getElementById('timeRemainingFilter') ? document.getElementById('timeRemainingFilter').value : 'all';
  const maxPrice = document.getElementById('maxPriceSlider') ? parseFloat(document.getElementById('maxPriceSlider').value) : 500;
  const sort = document.getElementById('sortSelect') ? document.getElementById('sortSelect').value : (userPreferences.defaultSort || 'watchlist');

  let positiveTerms = [];
  let negativeTerms = [];

  if (rawSearch) {
    const tokens = rawSearch.split(/\s+/);
    tokens.forEach(t => {
      if (t.startsWith('-') && t.length > 1) {
        negativeTerms.push(t.substring(1));
      } else {
        positiveTerms.push(t);
      }
    });
  }

  const now = Date.now();

  const visibleItems = allItems.filter(item => {
    // 1. Auto-hide ended items if enabled
    if (userPreferences.autoHideEnded && item.status === 'ended') return false;
    if (item._endsAtMs && item._endsAtMs <= now && userPreferences.autoHideEnded) return false;

    // 2. Exclude Keywords
    if (isExcludedMatch(item.title)) return false;

    // 3. Saved Favorites Only Filter
    if (filterSavedOnly && !savedFavoriteUrls.has(item.url)) return false;

    // 4. Isolated Watchlist Tag Filter
    if (isolatedKeyword) {
      if (!item._searchIndex.includes(isolatedKeyword.toLowerCase())) return false;
    }

    // 5. Positive and Negative Search Terms
    if (positiveTerms.length > 0) {
      const matchAll = positiveTerms.every(term => item._searchIndex.includes(term));
      if (!matchAll) return false;
    }
    if (negativeTerms.length > 0) {
      const matchAnyNegative = negativeTerms.some(term => item._searchIndex.includes(term));
      if (matchAnyNegative) return false;
    }

    // 6. Location Filter
    if (location !== 'all') {
      if (location === 'Raleigh' && item.location !== 'Raleigh') return false;
      if (location === 'SC' && item.location === 'Raleigh') return false;
    }

    // 7. Category Filter
    if (category !== 'all' && item.category !== category) return false;

    // 8. Top Deals (80+) Filter
    if (filterTopDealsOnly) {
      const score = item.dealScore ? item.dealScore.score : 0;
      if (score < 80) return false;
    }

    // 9. Budget Max Price Slider
    const outOfPocket = item.financials ? item.financials.totalNum : 0;
    if (maxPrice < 500 && outOfPocket > maxPrice) return false;

    // 10. Time Remaining Filter
    if (timeFilter !== 'all') {
      const timeInfo = formatTimeRemaining(item.endsAt, item.closingDate);
      if (timeFilter === 'urgent' && timeInfo.statusClass !== 'status-urgent') return false;
      if (timeFilter === 'today' && timeInfo.diffHours >= 24) return false;
      if (timeFilter === 'closing_2d' && timeInfo.diffHours >= 48) return false;
    }

    return true;
  });

  // Sorting Comparator
  visibleItems.sort((a, b) => {
    const watchA = isWatchlistMatch(a.title);
    const watchB = isWatchlistMatch(b.title);
    const favA = savedFavoriteUrls.has(a.url);
    const favB = savedFavoriteUrls.has(b.url);

    switch (sort) {
      case 'watchlist':
        if (favA && !favB) return -1;
        if (!favA && favB) return 1;
        if (watchA && !watchB) return -1;
        if (!watchA && watchB) return 1;
        return (b.dealScore ? b.dealScore.score : 0) - (a.dealScore ? a.dealScore.score : 0);

      case 'deal_score':
        return (b.dealScore ? b.dealScore.score : 0) - (a.dealScore ? a.dealScore.score : 0);

      case 'ending_soonest':
      case 'time-asc':
        return (a._endsAtMs || 0) - (b._endsAtMs || 0);

      case 'ending_latest':
      case 'time-desc':
        return (b._endsAtMs || 0) - (a._endsAtMs || 0);

      case 'date_asc':
      case 'date-asc':
      case 'day-asc': {
        const dateA = a.closingDate || (a.endsAt ? a.endsAt.split('T')[0] : '');
        const dateB = b.closingDate || (b.endsAt ? b.endsAt.split('T')[0] : '');
        const cmp = dateA.localeCompare(dateB);
        if (cmp !== 0) return cmp;
        return (a._endsAtMs || 0) - (b._endsAtMs || 0);
      }

      case 'date_desc':
      case 'date-desc':
      case 'day-desc': {
        const dateA = a.closingDate || (a.endsAt ? a.endsAt.split('T')[0] : '');
        const dateB = b.closingDate || (b.endsAt ? b.endsAt.split('T')[0] : '');
        const cmp = dateB.localeCompare(dateA);
        if (cmp !== 0) return cmp;
        return (b._endsAtMs || 0) - (a._endsAtMs || 0);
      }

      case 'savings_high':
      case 'savings-desc':
        return (b.financials && b.financials.savingsPct ? parseInt(b.financials.savingsPct) : 0) -
               (a.financials && a.financials.savingsPct ? parseInt(a.financials.savingsPct) : 0);

      case 'price_low':
      case 'total-asc':
        return (a.financials ? a.financials.totalNum : 0) - (b.financials ? b.financials.totalNum : 0);

      case 'price_high':
      case 'total-desc':
        return (b.financials ? b.financials.totalNum : 0) - (a.financials ? a.financials.totalNum : 0);

      case 'bid_low':
      case 'bid-asc':
        return (parseFloat(a.currentBid) || 0) - (parseFloat(b.currentBid) || 0);

      case 'bid_high':
      case 'bid-desc':
        return (parseFloat(b.currentBid) || 0) - (parseFloat(a.currentBid) || 0);

      case 'retail_high':
      case 'retail-desc':
        return (parseFloat(b.retailPrice) || 0) - (parseFloat(a.retailPrice) || 0);

      case 'title_asc':
      case 'title-asc':
        return (a.title || '').localeCompare(b.title || '');

      case 'title_desc':
      case 'title-desc':
        return (b.title || '').localeCompare(a.title || '');

      default:
        return (b.dealScore ? b.dealScore.score : 0) - (a.dealScore ? a.dealScore.score : 0);
    }
  });

  currentFilteredItems = visibleItems;
  if (resetChunkPagination) {
    currentRenderCount = PAGE_CHUNK_SIZE;
  }

  renderCardsChunk();
  updateMetrics(visibleItems);
}

function updateMetrics(visibleItems) {
  document.getElementById('statTotalItems').innerText = visibleItems.length;

  const watchMatches = visibleItems.filter(i => isWatchlistMatch(i.title)).length;
  document.getElementById('statWatchlistItems').innerText = watchMatches;

  const topDealsCount = allItems.filter(i => (i.dealScore ? i.dealScore.score : 0) >= 80).length;
  const topDealsLabel = document.getElementById('topDealsCountLabel');
  if (topDealsLabel) topDealsLabel.innerText = topDealsCount;

  if (visibleItems.length > 0) {
    const sum = visibleItems.reduce((acc, curr) => acc + (curr.financials ? curr.financials.totalNum : 0), 0);
    const avg = sum / visibleItems.length;
    document.getElementById('statAvgOutofPocket').innerText = `$${avg.toFixed(2)}`;
  } else {
    document.getElementById('statAvgOutofPocket').innerText = '$0.00';
  }

  const rawSearch = document.getElementById('searchInput') ? document.getElementById('searchInput').value.trim() : '';
  if (filterSavedOnly) {
    document.title = `Saved Favorites (${visibleItems.length}) | TL Auction Tracker`;
  } else if (rawSearch) {
    document.title = `Search: "${rawSearch}" (${visibleItems.length}) | TL Auction Tracker`;
  } else {
    document.title = `Live Auctions (${visibleItems.length}) | TL Auction Tracker`;
  }

  recalculateNextClosingTarget(allItems);
  updateNextClosingStat();
}

/**
 * PROGRESSIVE CATALOG INGESTION & CACHE
 */
function updateItemsProgressively(newItems, isDeltaSync = false) {
  if (!Array.isArray(newItems) || newItems.length === 0) return;

  const itemMap = new Map();
  if (isDeltaSync && allItems.length > 0) {
    for (let i = 0; i < allItems.length; i++) {
      itemMap.set(allItems[i].url, allItems[i]);
    }
  }

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i];
    if (!item || !item.url) continue;

    item.financials = calcFin(item.currentBid, item.retailPrice);
    item.dealScore = calculateDealScore(item.currentBid, item.retailPrice, item.condition, item.brand);
    item._endsAtMs = item.endsAt ? new Date(item.endsAt).getTime() : (item.closingDate ? new Date(item.closingDate).getTime() : 0);
    item._searchIndex = `${item.title || ''} ${item.category || ''} ${item.brand || ''} ${item.location || ''}`.toLowerCase();

    itemMap.set(item.url, item);
  }

  allItems = Array.from(itemMap.values());
  populateCategoryDropdown(allItems);
  recalculateNextClosingTarget(allItems);
  evaluateNotificationTriggers(newItems, !isDeltaSync);
  autoCleanEndedFavorites();
  updateScraperProgressUI(null, allItems.length);
  applyFilters(false);
  saveCatalogToIndexedDB(allItems);
}

async function fetchCatalog(isManualRefresh = false, sinceTimestamp = 0) {
  if (isFetchingCatalog) return;
  isFetchingCatalog = true;

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn && isManualRefresh) refreshBtn.classList.add('loading');

  try {
    let url = '/api/scrape';
    if (sinceTimestamp > 0) {
      url += `?since=${sinceTimestamp}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (data.items && Array.isArray(data.items)) {
      updateItemsProgressively(data.items, sinceTimestamp > 0);
      lastScrapeTimestamp = data.timestamp || Date.now();
    }
  } catch (err) {
    console.warn('[CATALOG FETCH] Fallback to cache:', err);
  } finally {
    isFetchingCatalog = false;
    if (refreshBtn) refreshBtn.classList.remove('loading');
  }
}

async function triggerDeepScan(maxPages = 60) {
  const scanBtn = document.getElementById('scanBtn');
  if (scanBtn) scanBtn.classList.add('loading');

  try {
    const res = await fetch(`/api/scrape?extend=true&deep=true&maxPages=${maxPages}`);
    const data = await res.json();
    if (data.items && Array.isArray(data.items)) {
      updateItemsProgressively(data.items, false);
      lastScrapeTimestamp = data.timestamp || Date.now();
      playSuccessChime();
    }
  } catch (e) {
    alert('Deep scan error: ' + e.message);
  } finally {
    if (scanBtn) scanBtn.classList.remove('loading');
  }
}

function initSSEStream() {
  if (!window.EventSource) return;

  const source = new EventSource('/api/stream');
  source.addEventListener('catalog_update', (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      if (payload.items) {
        updateItemsProgressively(payload.items, true);
      }
    } catch (e) {
      console.warn('[SSE] Error handling catalog update:', e);
    }
  });

  source.addEventListener('progress_update', (evt) => {
    try {
      const progress = JSON.parse(evt.data);
      updateScraperProgressUI(progress, allItems.length);
    } catch (e) {}
  });

  source.onerror = () => {
    console.warn('[SSE] stream disconnected, enabling fast poll fallback');
    startProgressPolling();
    source.close();
    setTimeout(initSSEStream, 10000);
  };
}

/**
 * ACCOUNT AUTH & WATCHLIST SYNC
 */
async function checkAuthStatus() {
  try {
    const res = await fetch('/api/account/status');
    const data = await res.json();
    const dot = document.getElementById('authStatusDot');
    const text = document.getElementById('authStatusText');

    if (data.hasCredentials) {
      if (dot) dot.className = 'status-dot connected';
      if (text) text.innerText = data.email ? `Connected: ${data.email.split('@')[0]}` : 'Account Connected';
    } else {
      if (dot) dot.className = 'status-dot disconnected';
      if (text) text.innerText = 'Connect Auction Account';
    }
  } catch (e) {}
}

async function saveAccountCredentials() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const alertEl = document.getElementById('authAlert');

  if (!email || !password) {
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.innerText = 'Please enter both your email and password.';
      alertEl.style.display = 'flex';
    }
    return;
  }

  try {
    const res = await fetch('/api/account/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (data.success) {
      if (alertEl) {
        alertEl.className = 'auth-alert success';
        alertEl.innerText = 'Credentials saved! You can now sync your live account watchlist.';
        alertEl.style.display = 'flex';
      }
      checkAuthStatus();
      setTimeout(closeCredentialsModal, 1500);
    } else {
      if (alertEl) {
        alertEl.className = 'auth-alert error';
        alertEl.innerText = data.error || 'Failed to save credentials.';
        alertEl.style.display = 'flex';
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.innerText = 'Network error saving credentials.';
      alertEl.style.display = 'flex';
    }
  }
}

async function syncLiveWatchlist() {
  const syncBtn = document.getElementById('syncWatchlistBtn');
  if (syncBtn) syncBtn.classList.add('loading');

  try {
    const res = await fetch('/api/account/sync-watchlist', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      if (data.syncedKeywords && data.syncedKeywords.length > 0) {
        data.syncedKeywords.forEach(kw => {
          if (!watchlistKeywords.some(k => k.keyword.toLowerCase() === kw.toLowerCase())) {
            watchlistKeywords.push({ keyword: kw, active: true });
          }
        });
        saveTagsState();
        renderSidebarTags();
        applyFilters();
      }
      playSuccessChime();
      alert(`Watchlist synced successfully! (${data.totalSynced || 0} items processed)`);
    } else {
      alert(`Sync error: ${data.error || 'Check auction account login.'}`);
    }
  } catch (err) {
    alert('Watchlist sync error: ' + err.message);
  } finally {
    if (syncBtn) syncBtn.classList.remove('loading');
  }
}

/**
 * INITIALIZATION PIPELINE
 */
async function initApp() {
  loadStorageState();
  loadNotificationsFromStorage();
  if (userPreferences.defaultSort && document.getElementById('sortSelect')) {
    document.getElementById('sortSelect').value = userPreferences.defaultSort;
  }
  setViewMode(currentViewMode);
  renderSidebarTags();

  // Load cached items from IndexedDB for instant first render (<100ms)
  const cachedItems = await loadCatalogFromIndexedDB();
  if (cachedItems && cachedItems.length > 0) {
    updateItemsProgressively(cachedItems, false);
  }

  // Fetch freshest catalog from server
  fetchCatalog(false);

  // Initialize live SSE stream
  initSSEStream();
  startProgressPolling();

  // Check account connection status
  checkAuthStatus();

  // Set up 1s timer loop for countdown badges
  setInterval(updateLiveTimers, 1000);

  // Auto-refresh catalog every 5 minutes
  setInterval(() => fetchCatalog(false, lastScrapeTimestamp), 300000);
}

document.addEventListener('DOMContentLoaded', initApp);

/**
 * FEATURE PARITY: Fallback Polling & Cleanup
 */
function updateScraperProgressUI(progress, totalIndexed) {
  const pctText = document.getElementById('progressPctText');
  const barFill = document.getElementById('progressBarFill');
  const statusMsg = document.getElementById('progressStatusMsg');
  const spinner = document.getElementById('progressSpinner');

  const count = totalIndexed || allItems.length;

  if (progress && progress.isScraping) {
    const pct = progress.progressPct || 15;
    if (pctText) pctText.innerText = `${pct}%`;
    if (barFill) barFill.style.width = `${pct}%`;
    if (statusMsg) statusMsg.innerText = `${progress.status || progress.currentAuction || 'Scanning...'} (${count} items loaded)`;
    if (spinner) spinner.style.display = 'inline-block';
  } else {
    if (pctText) pctText.innerText = '100%';
    if (barFill) barFill.style.width = '100%';
    if (statusMsg) statusMsg.innerText = `Ingestion Complete (${count} items ready)`;
    if (spinner) spinner.style.display = 'none';
  }
}

function startProgressPolling() {
  if (progressPollTimer) clearInterval(progressPollTimer);
  pollProgress();
  progressPollTimer = setInterval(pollProgress, 1000);
}

async function pollProgress() {
  try {
    const res = await fetch('/api/progress');
    const data = await res.json();
    updateScraperProgressUI(data, data.totalIndexed);

    if (data.isScraping || allItems.length < (data.totalIndexed || 0)) {
      fetchCatalog(false);
    }

    if (!data.isScraping && progressPollTimer) {
      clearInterval(progressPollTimer);
      progressPollTimer = null;
    }
  } catch (e) {
    console.error('[POLL] Error polling progress', e);
  }
}

function autoCleanEndedFavorites() {
  if (savedFavoriteUrls.size === 0 || allItems.length === 0) return;
  let removedCount = 0;
  const nowMs = Date.now();
  const BUFFER_MS = 2 * 60 * 60 * 1000; // 2 hours

  const itemMap = new Map();
  allItems.forEach(item => itemMap.set(item.url, item));

  Array.from(savedFavoriteUrls).forEach(url => {
    const item = itemMap.get(url);
    if (!item) {
      savedFavoriteUrls.delete(url);
      removedCount++;
    } else {
      let isPast = true;
      const endsMs = item.endsAt ? new Date(item.endsAt).getTime() : NaN;
      if (!isNaN(endsMs) && (endsMs + BUFFER_MS > nowMs)) {
        isPast = false;
      }
      if (item.closingDate) {
        const closingEndMs = new Date(`${item.closingDate}T23:59:59-04:00`).getTime();
        if (!isNaN(closingEndMs) && closingEndMs >= nowMs) {
          isPast = false;
        }
      }
      if (isPast) {
        savedFavoriteUrls.delete(url);
        removedCount++;
      }
    }
  });

  if (removedCount > 0 && typeof saveFavoritesState === 'function') {
    console.log(`[FAVORITES AUTO-PURGE] Purged ${removedCount} stale/orphan favorite URLs.`);
    saveFavoritesState();
  }
}
