/**
 * TL Auction Tracker - Storage & Persistence Engine
 * Handles IndexedDB catalog caching, LocalStorage state, and JSON backup export/import.
 */

const DEFAULT_WATCHLIST = [
  'apple', 'dewalt', 'milwaukee', 'ryobi', 'bose', 'sony', 'dyson',
  'generator', 'inverter', 'kayak', 'lego', 'traeger', 'blackstone',
  'nintendo', 'playstation', 'xbox', 'tool', 'pressure washer'
];

const DEFAULT_EXCLUDES = [
  'damaged', 'broken', 'salvage', 'parts only', 'as-is', 'as is'
];

let watchlistKeywords = [];
let excludeKeywords = [];
let savedFavoriteUrls = new Set();
let userPreferences = {
  defaultLocation: 'all',
  defaultSort: 'watchlist',
  autoHideEnded: true,
  enableSounds: true,
  enablePush: false,
  webhookUrl: '',
  alertWatchlist: true,
  alertDeals: true,
  alertEndingSoon: true
};

function loadStorageState() {
  // 1. Watchlist Keywords
  try {
    const raw = localStorage.getItem('tl_watchlist_keywords');
    if (raw) {
      watchlistKeywords = JSON.parse(raw);
    } else {
      watchlistKeywords = DEFAULT_WATCHLIST.map(k => ({ keyword: k, active: true }));
      saveTagsState();
    }
  } catch (e) {
    watchlistKeywords = DEFAULT_WATCHLIST.map(k => ({ keyword: k, active: true }));
  }

  // 2. Exclude Keywords
  try {
    const raw = localStorage.getItem('tl_exclude_keywords');
    if (raw) {
      excludeKeywords = JSON.parse(raw);
    } else {
      excludeKeywords = DEFAULT_EXCLUDES.map(k => ({ keyword: k, active: true }));
      saveExcludeTagsState();
    }
  } catch (e) {
    excludeKeywords = DEFAULT_EXCLUDES.map(k => ({ keyword: k, active: true }));
  }

  // 3. Saved Favorites
  try {
    const raw = localStorage.getItem('tl_saved_favorite_urls');
    if (raw) {
      savedFavoriteUrls = new Set(JSON.parse(raw));
    }
  } catch (e) {
    savedFavoriteUrls = new Set();
  }

  // 4. User Preferences
  try {
    const raw = localStorage.getItem('tl_user_preferences');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old defaultSort values from previous builds
      if (!parsed.defaultSort || parsed.defaultSort === 'ending_soonest' || parsed.defaultSort === 'time-asc' || parsed.defaultSort === 'deal_score') {
        parsed.defaultSort = 'watchlist';
      }
      userPreferences = Object.assign({}, userPreferences, parsed);
    } else {
      userPreferences.defaultSort = 'watchlist';
      savePreferencesState();
    }
  } catch (e) {
    console.warn('[STORAGE] Failed to parse user preferences:', e);
  }
}

function saveTagsState() {
  localStorage.setItem('tl_watchlist_keywords', JSON.stringify(watchlistKeywords));
}

function saveExcludeTagsState() {
  localStorage.setItem('tl_exclude_keywords', JSON.stringify(excludeKeywords));
}

function saveFavoritesState() {
  localStorage.setItem('tl_saved_favorite_urls', JSON.stringify(Array.from(savedFavoriteUrls)));
}

function savePreferencesState() {
  localStorage.setItem('tl_user_preferences', JSON.stringify(userPreferences));
}

/**
 * INDEXEDDB CATALOG CACHE
 */
const IDB_NAME = 'TL_Catalog_DB';
const IDB_VERSION = 1;
const IDB_STORE = 'catalog_items';

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (evt) => resolve(evt.target.result);
    req.onerror = (evt) => reject(evt.target.error);
  });
}

async function saveCatalogToIndexedDB(items) {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.clear();
    for (let i = 0; i < items.length; i++) {
      store.put(items[i]);
    }
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('[IDB] Catalog persistence fallback:', e);
  }
}

async function loadCatalogFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.getAll();
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    return [];
  }
}

/**
 * EXPORT / IMPORT BACKUP JSON
 */
function exportUserDataJSON() {
  const data = {
    app: 'TL Auction Tracker',
    version: 2,
    exportDate: new Date().toISOString(),
    watchlistKeywords,
    excludeKeywords,
    savedFavorites: Array.from(savedFavoriteUrls),
    preferences: userPreferences,
    // Backwards-compatible aliases
    activeWatchlistKeywords: watchlistKeywords.map(k => typeof k === 'string' ? k : k.keyword),
    activeExcludeWatchlistKeywords: excludeKeywords.map(k => typeof k === 'string' ? k : k.keyword),
    savedFavoriteUrls: Array.from(savedFavoriteUrls),
    settings: userPreferences
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tl_dashboard_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showBackupAlert('success', 'Backup exported successfully! File downloaded.');
}

function handleImportFileSelect(file) {
  if (file) {
    showBackupAlert('info', `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB). Click "Import & Restore" to proceed.`);
  }
}

function importUserDataJSON(explicitFile) {
  const fileInput = document.getElementById('importFileInput');
  const file = explicitFile || (fileInput && fileInput.files ? fileInput.files[0] : null);
  const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';

  if (!file) {
    showBackupAlert('error', 'Please select a valid .json backup file first.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid JSON format');
      }

      // Extract watchlist keywords (supporting objects or strings)
      const rawWatchlist = data.watchlistKeywords || data.activeWatchlistKeywords || [];
      const normalizedWatchlist = rawWatchlist.map(k => typeof k === 'string' ? { keyword: k, active: true } : k);

      // Extract exclude keywords
      const rawExclude = data.excludeKeywords || data.activeExcludeWatchlistKeywords || [];
      const normalizedExclude = rawExclude.map(k => typeof k === 'string' ? { keyword: k, active: true } : k);

      // Extract favorites
      const rawFavorites = data.savedFavorites || data.savedFavoriteUrls || [];

      // Extract preferences
      const rawPrefs = data.preferences || data.settings || {};

      if (mode === 'replace') {
        watchlistKeywords = normalizedWatchlist;
        excludeKeywords = normalizedExclude;
        savedFavoriteUrls = new Set(rawFavorites);
        userPreferences = Object.assign({}, userPreferences, rawPrefs);
      } else {
        // Merge mode
        normalizedWatchlist.forEach(item => {
          const kw = typeof item === 'string' ? item : item.keyword;
          if (!watchlistKeywords.some(k => (typeof k === 'string' ? k : k.keyword).toLowerCase() === kw.toLowerCase())) {
            watchlistKeywords.push(typeof item === 'string' ? { keyword: item, active: true } : item);
          }
        });

        normalizedExclude.forEach(item => {
          const kw = typeof item === 'string' ? item : item.keyword;
          if (!excludeKeywords.some(k => (typeof k === 'string' ? k : k.keyword).toLowerCase() === kw.toLowerCase())) {
            excludeKeywords.push(typeof item === 'string' ? { keyword: item, active: true } : item);
          }
        });

        rawFavorites.forEach(url => savedFavoriteUrls.add(url));
        userPreferences = Object.assign({}, userPreferences, rawPrefs);
      }

      // Persist state
      saveTagsState();
      saveExcludeTagsState();
      saveFavoritesState();
      savePreferencesState();

      // Refresh UI
      renderSidebarTags();
      renderModalTags();
      renderExcludeTags();
      applyFilters();
      playSuccessChime();

      showBackupAlert('success', `Dashboard configuration imported successfully (${mode} mode)!`);
      if (fileInput) fileInput.value = '';
    } catch (err) {
      showBackupAlert('error', 'Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function showBackupAlert(type, msg) {
  const alertBox = document.getElementById('backupAlert');
  if (!alertBox) return;
  alertBox.className = `auth-alert ${type === 'error' ? 'error' : (type === 'success' ? 'success' : 'info')}`;
  alertBox.innerHTML = `
    <i class="fa-solid fa-${type === 'success' ? 'circle-check' : (type === 'error' ? 'circle-xmark' : 'circle-info')}"></i>
    <span>${escapeHtml(msg)}</span>
  `;
  alertBox.style.display = 'flex';
}
