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
  defaultSort: 'ending_soonest',
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
      userPreferences = Object.assign({}, userPreferences, JSON.parse(raw));
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
    version: 2,
    timestamp: new Date().toISOString(),
    watchlistKeywords,
    excludeKeywords,
    savedFavorites: Array.from(savedFavoriteUrls),
    preferences: userPreferences
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tl_dashboard_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importUserDataJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.watchlistKeywords && Array.isArray(data.watchlistKeywords)) {
        watchlistKeywords = data.watchlistKeywords;
        saveTagsState();
      }
      if (data.excludeKeywords && Array.isArray(data.excludeKeywords)) {
        excludeKeywords = data.excludeKeywords;
        saveExcludeTagsState();
      }
      if (data.savedFavorites && Array.isArray(data.savedFavorites)) {
        savedFavoriteUrls = new Set(data.savedFavorites);
        saveFavoritesState();
      }
      if (data.preferences && typeof data.preferences === 'object') {
        userPreferences = Object.assign({}, userPreferences, data.preferences);
        savePreferencesState();
      }
      alert('Preferences, Watchlist, and Saved Items imported successfully!');
      location.reload();
    } catch (err) {
      alert('Invalid backup JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
}
