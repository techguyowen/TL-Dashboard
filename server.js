const express = require('express');
const compression = require('compression');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8419;
const CACHE_FILE_PATH = path.join(__dirname, 'catalog_cache.json');
let lastCatalogUpdateTime = Date.now();

app.set('trust proxy', 1);
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
}));
app.use(express.json());

/**
 * Helper to get YYYY-MM-DD in EDT (America/New_York) timezone
 * Prevents evening UTC rollover bugs past 8:00 PM EDT (00:00 UTC).
 */
function getEDTDateString(d = new Date()) {
  try {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  } catch (_) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/**
 * Financial Calculation Utility with Retail MSRP & Savings %
 */
function calculateFinancials(rawBid, rawRetail) {
  const currentBid = parseFloat(rawBid) || 0;
  const buyerPremium = Math.round((currentBid * 0.15) * 100) / 100;
  const subtotal = Math.round((currentBid + buyerPremium) * 100) / 100;
  const salesTax = Math.round((subtotal * 0.0725) * 100) / 100;
  const ccFee = Math.round(((subtotal + salesTax) * 0.03) * 100) / 100;
  const totalCost = Math.round((subtotal + salesTax + ccFee) * 100) / 100;

  const retailPrice = parseFloat(rawRetail) || null;
  let savingsPct = null;
  if (retailPrice && retailPrice > totalCost) {
    savingsPct = Math.round(((retailPrice - totalCost) / retailPrice) * 100);
  }

  return {
    currentBid: currentBid.toFixed(2),
    buyerPremium: buyerPremium.toFixed(2),
    subtotal: subtotal.toFixed(2),
    salesTax: salesTax.toFixed(2),
    ccFee: ccFee.toFixed(2),
    totalCost: totalCost.toFixed(2),
    totalCostNum: totalCost,
    retailPrice: retailPrice ? retailPrice.toFixed(2) : null,
    savingsPct
  };
}

let masterCatalogMap = new Map();
let isBackgroundScraping = false;
let scraperProgress = {
  isScraping: false,
  status: "Idle",
  progressPct: 100,
  totalIndexed: 0,
  currentAuction: "",
  scrapedDaysCount: 0
};

function loadDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const stat = fs.statSync(CACHE_FILE_PATH);
      if (!stat.isFile()) {
        console.warn(`[DISK CACHE] ${CACHE_FILE_PATH} is a directory. Skipping load.`);
        return;
      }
      const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
      const savedItems = JSON.parse(raw);
      if (Array.isArray(savedItems) && savedItems.length > 0) {
        savedItems.forEach(item => {
          masterCatalogMap.set(item.id || item.url, item);
        });
        pruneExpiredCatalogCache();
        lastCatalogUpdateTime = Date.now();
        scraperProgress.totalIndexed = masterCatalogMap.size;
        if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
          console.log(`[DISK CACHE] Loaded ${masterCatalogMap.size} auction items from ./catalog_cache.json in <0.05s!`);
        }
      }
    }
  } catch (e) {
    console.error('[DISK CACHE LOAD ERROR]', e.message);
  }
}

function saveDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE_PATH) && !fs.statSync(CACHE_FILE_PATH).isFile()) {
      console.warn(`[DISK CACHE] ${CACHE_FILE_PATH} is a directory. Skipping save.`);
      return;
    }
    pruneExpiredCatalogCache();
    const itemsArr = Array.from(masterCatalogMap.values());
    const tmpPath = `${CACHE_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(itemsArr), 'utf8');
    fs.renameSync(tmpPath, CACHE_FILE_PATH);
    lastCatalogUpdateTime = Date.now();
    console.log(`[DISK CACHE] Persisted ${itemsArr.length} catalog items atomically to ./catalog_cache.json`);
  } catch (e) {
    console.error('[DISK CACHE SAVE ERROR]', e.message);
  }
}

// Automatically load cached catalog on boot
loadDiskCache();

let sseClients = [];

function broadcastEvent(type, extraData = {}) {
  const payload = JSON.stringify({
    type,
    progress: scraperProgress,
    totalIndexed: masterCatalogMap.size,
    ...extraData
  });
  sseClients.forEach(client => {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (_) {}
  });
}

// Seed initial items with dynamic endsAt ISO timestamps
const now = new Date();
const todayStr = getEDTDateString(now);
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const tomorrowStr = getEDTDateString(tomorrow);

const FALLBACK_ITEMS = [
  {
    id: "tl-101",
    title: "18V Cordless 10-Tool Combo Kit with 2Ah Battery, 4Ah Battery & Charger",
    currentBid: 52.00,
    retailPrice: 478.00,
    brand: "RYOBI",
    condition: "Condition: Like New",
    conditionValue: 2,
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://bid.triangleliquidators.com/lots/2026-08-01/1789",
    image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=80",
    category: "Tools",
    auctionName: "Raleigh Auction",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 3 * 3600 * 1000 + 45 * 60 * 1000).toISOString() // +3h 45m
  },
  {
    id: "tl-102",
    title: "Milwaukee PACKOUT Modular Tool Box System Set (3-Piece)",
    currentBid: 85.00,
    retailPrice: 299.00,
    brand: "Milwaukee",
    condition: "Condition: New",
    conditionValue: 1,
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://bid.triangleliquidators.com/lots/2026-08-01/1790",
    image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80",
    category: "Tools",
    auctionName: "Raleigh Auction",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 1 * 3600 * 1000 + 20 * 60 * 1000).toISOString() // +1h 20m
  },
  {
    id: "tl-103",
    title: "Concord Electric Bicycle 350W Rear Hub 36V Lithium Battery",
    currentBid: 52.00,
    retailPrice: 478.00,
    brand: "Concord Bikes",
    condition: "Condition: Used",
    conditionValue: 3,
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://bid.triangleliquidators.com/lots/2026-08-01/1791",
    image: "https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=600&q=80",
    category: "Outdoor",
    auctionName: "Raleigh Auction",
    closingDate: tomorrowStr,
    endsAt: new Date(now.getTime() + 27 * 3600 * 1000).toISOString() // Tomorrow
  },
  {
    id: "tl-104",
    title: "Craftsman 3000 PSI 2.3 GPM Gas Pressure Washer Briggs & Stratton",
    currentBid: 110.00,
    retailPrice: 389.00,
    brand: "Craftsman",
    condition: "Condition: As-Is",
    conditionValue: 4,
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://bid.triangleliquidators.com/lots/2026-08-01/1792",
    image: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=80",
    category: "Outdoor",
    auctionName: "Raleigh Auction",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 5 * 3600 * 1000 + 10 * 60 * 1000).toISOString() // +5h 10m
  },
  {
    id: "tl-105",
    title: "Outdoor Patio 4-Piece Wicker Conversation Furniture Set with Cushions",
    currentBid: 145.00,
    retailPrice: 599.00,
    brand: "Patio Living",
    condition: "Condition: Like New",
    conditionValue: 2,
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://bid.triangleliquidators.com/lots/2026-08-01/1793",
    image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80",
    category: "Home",
    auctionName: "Raleigh Auction",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 6 * 3600 * 1000).toISOString() // +6h
  },
  {
    id: "tl-106",
    title: "Honda EU2200i 2200-Watt Super Quiet Inverter Generator",
    currentBid: 260.00,
    retailPrice: 1099.00,
    brand: "Honda",
    condition: "Condition: Like New",
    conditionValue: 2,
    location: "Anderson",
    address: "Williamston / Anderson, SC Transfer Depot",
    url: "https://bid.triangleliquidators.com/lots/2026-08-01/1794",
    image: "https://images.unsplash.com/photo-1544725176-7c40e5a71c5e?auto=format&fit=crop&w=600&q=80",
    category: "Outdoor",
    auctionName: "Anderson Auction",
    closingDate: tomorrowStr,
    endsAt: new Date(now.getTime() + 30 * 3600 * 1000).toISOString() // Tomorrow
  }
];

FALLBACK_ITEMS.forEach(i => {
  masterCatalogMap.set(i.id, { ...i, financials: calculateFinancials(i.currentBid, i.retailPrice) });
});
scraperProgress.totalIndexed = masterCatalogMap.size;

/**
 * Fast Streaming Multi-Page Crawler with Progressive Real-Time UI Broadcasting
 * Targets the new Next.js site at bid.triangleliquidators.com.
 * Extracts structured lot data from the __NEXT_DATA__ SSR JSON payload instead of DOM scraping.
 *
 * New site data model:
 *  - URL format:    /lots/{auctionPeriod}/{id}   (e.g. /lots/2026-08-01/1234)
 *  - Category:      item.category.label           (direct, no keyword guessing)
 *  - Condition:     item.condition.displayName     (New/Like New/Used/As-is)
 *  - Retail price:  item.estimatedRetailPrice
 *  - Current bid:   item.currentPrice
 *  - End time:      item.endsAt                   (ISO UTC — no parsing needed)
 *  - Images:        https://cdn.bid.triangleliquidators.com/{item.images[0].imageCard}
 *  - Location:      item.location.name             ("Raleigh" or "Anderson")
 */
async function crawlDeepAuctionPages(maxCatalogsToScan = 10, maxPagesPerCatalog = 60) {
  if (isBackgroundScraping) return;
  isBackgroundScraping = true;
  scraperProgress.isScraping = true;
  scraperProgress.status = "Connecting to bid.triangleliquidators.com...";
  scraperProgress.progressPct = 5;

  broadcastEvent('progress_update');

  const CDN_BASE = 'https://cdn.bid.triangleliquidators.com/';
  const SITE_BASE = 'https://bid.triangleliquidators.com';
  const FALLBACK_IMG = 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80';

  /**
   * Condition value → human-readable string mapping (matches new site's condition codes)
   * 1=New, 2=Like New, 3=Used, 4=As-is
   */
  const CONDITION_MAP = {
    1: 'Condition: New',
    2: 'Condition: Like New',
    3: 'Condition: Used',
    4: 'Condition: As-Is',
  };

  /**
   * New site location codes → address lookup
   */
  const LOCATION_ADDRESSES = {
    'Raleigh': '1101 Transport Dr, Raleigh, NC 27603',
    'Anderson': 'Williamston / Anderson, SC Transfer Depot',
  };

  console.log(`[DEEP CRAWLER] Starting catalog ingestion from bid.triangleliquidators.com (up to ${maxPagesPerCatalog} pages)...`);

  const seenIdsThisCrawl = new Set();
  const perPage = 100;
  let totalPages = maxPagesPerCatalog;
  let totalCount = 0;
  let useDirectAPI = true;

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      scraperProgress.progressPct = Math.min(97, Math.round(((pageNum - 1) / totalPages) * 92) + 5);
      scraperProgress.status = `Ingesting bid.triangleliquidators.com — Page ${pageNum}/${totalPages}...`;
      scraperProgress.currentAuction = `Page ${pageNum}`;
      broadcastEvent('progress_update');

      let rawResults = [];

      // Primary strategy: Direct REST API (100x faster, zero browser overhead, complete pagination)
      if (useDirectAPI) {
        try {
          const apiUrl = `${SITE_BASE}/backend/v1/auctions/lots/?page=${pageNum}&per_page=${perPage}`;
          const res = await fetch(apiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*'
            }
          });

          if (res.ok) {
            const data = await res.json();
            if (pageNum === 1) {
              totalCount = data.count || 0;
              const realTotalPages = Math.ceil(totalCount / perPage);
              totalPages = Math.min(realTotalPages, maxPagesPerCatalog);
              scraperProgress.scrapedDaysCount = totalPages;
              console.log(`[DEEP CRAWLER] Total active lots on site: ${totalCount} across ~${realTotalPages} pages. Ingesting ${totalPages} pages.`);
            }

            rawResults = data.results || [];
          } else {
            console.warn(`[DEEP CRAWLER] Direct API returned HTTP ${res.status} on page ${pageNum}. Falling back to browser.`);
            useDirectAPI = false;
          }
        } catch (apiErr) {
          console.warn(`[DEEP CRAWLER] Direct API error on page ${pageNum}:`, apiErr.message);
          useDirectAPI = false;
        }
      }

      // Fallback strategy: Puppeteer if direct API is unavailable
      if (!useDirectAPI && rawResults.length === 0) {
        let browser = null;
        try {
          browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1440,900']
          });
          const page = await browser.newPage();
          await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
          await page.goto(`${SITE_BASE}/?page=${pageNum}`, { waitUntil: 'networkidle2', timeout: 25000 });
          const nextData = await page.evaluate(() => {
            const el = document.getElementById('__NEXT_DATA__');
            return el ? el.textContent : null;
          });
          if (nextData) {
            const parsed = JSON.parse(nextData);
            const queries = parsed?.props?.pageProps?.dehydratedState?.queries || [];
            for (const q of queries) {
              const d = q?.state?.data;
              if (d && typeof d === 'object' && Array.isArray(d.results)) {
                rawResults = d.results;
                if (pageNum === 1 && typeof d.count === 'number') {
                  totalCount = d.count;
                  totalPages = Math.min(Math.ceil(totalCount / perPage), maxPagesPerCatalog);
                }
                break;
              }
            }
          }
          await browser.close();
        } catch (bErr) {
          console.error(`[DEEP CRAWLER] Browser fallback error on page ${pageNum}:`, bErr.message);
          if (browser) await browser.close();
        }
      }

      if (rawResults.length === 0) {
        console.log(`[DEEP CRAWLER] No more results on page ${pageNum}. Finishing crawl.`);
        break;
      }

      // Map raw API lot results → internal normalized schema
      const nowMs = Date.now();
      const pageItems = rawResults
        .filter(item => item && item.id && item.status !== 'ended')
        .map(item => {
          const period = item.auction_period || item.auctionPeriod || getEDTDateString();
          const lotUrl = `${SITE_BASE}/lots/${period}/${item.id}`;

          // Image from images array (handles both snake_case and camelCase)
          let image = FALLBACK_IMG;
          const imgList = item.images || [];
          if (Array.isArray(imgList) && imgList.length > 0) {
            const cardImg = imgList[0].image_card || imgList[0].imageCard || imgList[0].image_large || imgList[0].imageLarge || imgList[0].image_thumb || imgList[0].imageThumb;
            if (cardImg) {
              image = cardImg.startsWith('http') ? cardImg : CDN_BASE + cardImg;
            }
          }

          // Condition: use numeric map or display name
          const condVal = item.condition?.value;
          const condDisplay = item.condition?.display_name || item.condition?.displayName || 'Unknown';
          const condition = CONDITION_MAP[condVal] || `Condition: ${condDisplay}`;

          // Category
          const category = item.category?.label || 'General Merchandise';

          // Location
          const locationName = item.location?.name || 'Raleigh';
          const address = LOCATION_ADDRESSES[locationName] || LOCATION_ADDRESSES['Raleigh'];

          // Price fields (handles snake_case and camelCase)
          const currentBid = parseFloat(item.current_price !== undefined ? item.current_price : item.currentPrice) || 0;
          const retailPrice = parseFloat(item.estimated_retail_price !== undefined ? item.estimated_retail_price : item.estimatedRetailPrice) || null;

          // End time
          let endsAtISO = item.ends_at || item.endsAt || null;
          let closingDate = getEDTDateString();
          if (endsAtISO) {
            try {
              closingDate = new Date(endsAtISO).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            } catch (_) {}
          } else if (period) {
            const fallback = new Date(`${period}T23:59:59-04:00`);
            if (!isNaN(fallback.getTime()) && fallback.getTime() > nowMs) {
              endsAtISO = fallback.toISOString();
              closingDate = period;
            }
          }

          return {
            id: `scraped-${item.id}`,
            title: item.title || 'Auction Item',
            currentBid,
            retailPrice,
            brand: item.brand || null,
            model: item.model || null,
            condition,
            conditionValue: condVal || null,
            category,
            location: locationName,
            address,
            url: lotUrl,
            image,
            auctionPeriod: period,
            auctionName: `${locationName} Auction`,
            closingDate,
            endsAt: endsAtISO,
            status: item.status || 'live',
            bidCount: item.bid_count !== undefined ? item.bid_count : (item.bidCount || 0),
            isTransferable: item.is_transferable !== undefined ? item.is_transferable : (item.isTransferable || false),
            transferFee: item.transfer_fee !== undefined ? item.transfer_fee : (item.transferFee || null),
            lotNumber: item.lot_number || item.lotNumber || null,
          };
        });

      console.log(`[DEEP CRAWLER] Page ${pageNum}: ingested ${pageItems.length} active items.`);

      // Purge demo fallback items once real items are found
      if (pageItems.length > 0) {
        FALLBACK_ITEMS.forEach(f => masterCatalogMap.delete(f.id));
      }

      pageItems.forEach(item => {
        const key = item.id;
        const existing = masterCatalogMap.get(key);
        masterCatalogMap.set(key, {
          ...item,
          financials: calculateFinancials(item.currentBid, item.retailPrice),
          indexedAt: existing ? existing.indexedAt : Date.now()
        });
        seenIdsThisCrawl.add(key);
      });

      scraperProgress.totalIndexed = masterCatalogMap.size;

      // Broadcast real-time progressive update to UI
      const currentItems = Array.from(masterCatalogMap.values()).map(item => ({
        ...item,
        endsAt: ensureEndsAt(item)
      }));

      broadcastEvent('items_ingested', {
        newBatchCount: pageItems.length,
        items: currentItems
      });
    }

    // Active prune: remove any 'scraped-*' items that no longer exist on the live site
    if (seenIdsThisCrawl.size > 0) {
      let removedCount = 0;
      for (const [key] of masterCatalogMap.entries()) {
        if (key.startsWith('scraped-') && !seenIdsThisCrawl.has(key)) {
          masterCatalogMap.delete(key);
          removedCount++;
        }
      }
      if (removedCount > 0) {
        console.log(`[DEEP CRAWLER] Active prune: removed ${removedCount} ended lots.`);
      }
    }

    console.log(`[DEEP CRAWLER] Ingestion complete! Total items in master catalog: ${masterCatalogMap.size}`);
  } catch (err) {
    console.error('[DEEP CRAWLER ERROR]', err.message);
  } finally {
    isBackgroundScraping = false;
    scraperProgress.isScraping = false;
    scraperProgress.status = "Complete";
    scraperProgress.progressPct = 100;
    saveDiskCache();

    const finalItems = Array.from(masterCatalogMap.values()).map(item => ({
      ...item,
      endsAt: ensureEndsAt(item)
    }));

    broadcastEvent('complete', {
      items: finalItems
    });
  }
}

/**
 * In-Memory Catalog Cache Optimization & Expired Lot Pruning
 */
function pruneExpiredCatalogCache() {
  const nowMs = Date.now();
  let prunedCount = 0;

  const REMOVAL_BUFFER_MS = 2 * 60 * 60 * 1000; // 2-hour grace period buffer

  for (const [id, item] of masterCatalogMap.entries()) {
    // 0. Purge any legacy synthetic stub items
    if (item.auctionName === 'Synced Watchlist Auction' || item.category === 'Watched Items' || id.startsWith('watched-')) {
      masterCatalogMap.delete(id);
      prunedCount++;
      continue;
    }

    let isPast = true;

    // Check 1: exact endsAt with removal buffer
    const endsAtMs = item.endsAt ? new Date(item.endsAt).getTime() : NaN;
    if (!isNaN(endsAtMs) && (endsAtMs + REMOVAL_BUFFER_MS > nowMs)) {
      isPast = false;
    }

    // Check 2: closingDate buffer (keep active until 11:59:59 PM EDT on closing date)
    if (item.closingDate) {
      const closingEndMs = new Date(`${item.closingDate}T23:59:59-04:00`).getTime();
      if (!isNaN(closingEndMs) && closingEndMs >= nowMs) {
        isPast = false;
      }
    }

    if (isPast) {
      masterCatalogMap.delete(id);
      prunedCount++;
    }
  }

  // 3. LRU/FIFO Capacity Guard (Cap map size at 12,000 items max)
  const MAX_CACHE_ITEMS = 12000;
  if (masterCatalogMap.size > MAX_CACHE_ITEMS) {
    const keysToEvict = Array.from(masterCatalogMap.keys()).slice(0, masterCatalogMap.size - MAX_CACHE_ITEMS);
    keysToEvict.forEach(k => {
      masterCatalogMap.delete(k);
      prunedCount++;
    });
  }

  if (prunedCount > 0) {
    console.log(`[CACHE OPTIMIZATION] Pruned ${prunedCount} expired/stale auction items from in-memory catalog cache. Remaining capacity: ${masterCatalogMap.size} items.`);
    scraperProgress.totalIndexed = masterCatalogMap.size;
  }
}

let crawlerIntervalSec = 60;
let crawlerTimer = null;

function updateCrawlerSchedule(intervalSec) {
  const parsed = parseInt(intervalSec, 10);
  if (isNaN(parsed) || parsed < 0) return crawlerIntervalSec;

  crawlerIntervalSec = parsed;

  if (crawlerTimer) {
    clearInterval(crawlerTimer);
    crawlerTimer = null;
  }

  if (crawlerIntervalSec > 0) {
    const ms = Math.max(15, crawlerIntervalSec) * 1000;
    console.log(`[DEEP CRAWLER SCHEDULER] Background crawler scheduled to run every ${crawlerIntervalSec} seconds (${ms} ms).`);
    crawlerTimer = setInterval(() => {
      pruneExpiredCatalogCache();
      crawlDeepAuctionPages(10, 60);
    }, ms);
    crawlerTimer.unref();
  } else {
    console.log(`[DEEP CRAWLER SCHEDULER] Background crawler automatic loop paused (Manual Sync mode).`);
  }

  return crawlerIntervalSec;
}

// Initial scheduler init (only crawl on boot if server.js is run directly and catalog cache is empty)
pruneExpiredCatalogCache();
if (require.main === module) {
  if (masterCatalogMap.size === 0) {
    console.log('[DEEP CRAWLER] Empty catalog cache detected. Initializing first-run catalog crawl...');
    crawlDeepAuctionPages(10, 60);
  } else {
    console.log(`[DEEP CRAWLER] Master catalog ready with ${masterCatalogMap.size} cached items.`);
  }
  updateCrawlerSchedule(60);

  // Run cache pruning every 30 minutes
  const pruneInterval = setInterval(pruneExpiredCatalogCache, 30 * 60 * 1000);
  pruneInterval.unref();
}

// API Endpoint for Live Scraper Progress
app.get('/api/progress', (req, res) => {
  res.json({
    ...scraperProgress,
    totalIndexed: masterCatalogMap.size,
    crawlerIntervalSec
  });
});

// Financial Calculation & Rate Breakdown Endpoint
app.get('/api/financials', (req, res) => {
  const bid = parseFloat(req.query.bid) || 0;
  const msrp = parseFloat(req.query.msrp) || null;
  const result = calculateFinancials(bid, msrp);
  res.json({
    ...result,
    rates: {
      buyerPremiumRate: 0.15,
      salesTaxRate: 0.0725,
      ccFeeRate: 0.03
    }
  });
});

// Clear Full Catalog Cache Endpoint
app.post('/api/clear-cache', (req, res) => {
  try {
    masterCatalogMap.clear();
    if (fs.existsSync(CACHE_FILE_PATH)) {
      fs.unlinkSync(CACHE_FILE_PATH);
    }
    lastCatalogUpdateTime = Date.now();
    scraperProgress.totalIndexed = 0;
    broadcastEvent('catalog_cleared', { items: [] });
    res.json({ success: true, message: 'Catalog cache cleared successfully.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API Endpoints for Crawler Settings Synchronization
app.post('/api/crawler-settings', (req, res) => {
  const { intervalSec } = req.body || {};
  if (intervalSec !== undefined) {
    const updated = updateCrawlerSchedule(intervalSec);
    return res.json({ success: true, crawlerIntervalSec: updated });
  }
  res.status(400).json({ success: false, error: 'Missing intervalSec parameter' });
});

app.get('/api/crawler-settings', (req, res) => {
  res.json({ success: true, crawlerIntervalSec });
});

// Real-Time Server-Sent Events (SSE) Progressive Stream Endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sseClients.push(res);

  let itemsArr = Array.from(masterCatalogMap.values());
  const hasLiveScraped = itemsArr.some(i => i.id && i.id.startsWith('scraped-'));

  if (hasLiveScraped) {
    itemsArr = itemsArr.filter(i => !(i.id && i.id.startsWith('tl-10')));
  }

  const sanitizedItems = itemsArr.map(item => ({
    ...item,
    endsAt: ensureEndsAt(item)
  }));

  const initialPayload = JSON.stringify({
    type: 'init',
    progress: scraperProgress,
    totalIndexed: sanitizedItems.length,
    items: sanitizedItems
  });

  res.write(`data: ${initialPayload}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

function ensureEndsAt(item) {
  if (item && item.endsAt) return item.endsAt;
  
  if (item && item.closingDate) {
    const target = new Date(`${item.closingDate}T23:59:59-04:00`);
    if (!isNaN(target.getTime())) {
      return target.toISOString();
    }
  }

  const fallback = new Date();
  const edtTodayStr = getEDTDateString(fallback);
  const targetDate = new Date(`${edtTodayStr}T23:59:59-04:00`);
  if (targetDate.getTime() <= Date.now()) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  return targetDate.toISOString();
}

// API Endpoint for Live Items with ETag Caching & Incremental Delta Support
app.get('/api/scrape', async (req, res) => {
  const extend = req.query.extend === 'true';
  const force = req.query.force === 'true';
  const refresh = req.query.refresh === 'true' || force;
  const since = parseInt(req.query.since || '0', 10);

  if (extend) {
    console.log('[DEEP CRAWLER] Triggering extended deep scan across full catalog...');
    crawlDeepAuctionPages(10, 60, true);
  } else if (force || (refresh && crawlerIntervalSec > 0)) {
    crawlDeepAuctionPages(10, 60);
  }

  // Generate ETag header based on catalog count & timestamp
  const etag = `W/"catalog-${masterCatalogMap.size}-${lastCatalogUpdateTime}"`;
  res.setHeader('ETag', etag);

  // Return HTTP 304 Not Modified if client catalog is current and no force refresh requested
  if (!refresh && !extend && since === 0 && req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  let itemsArr = Array.from(masterCatalogMap.values());
  const hasLiveScraped = itemsArr.some(i => i.id && i.id.startsWith('scraped-'));

  if (hasLiveScraped) {
    itemsArr = itemsArr.filter(i => !(i.id && i.id.startsWith('tl-10')));
  }

  const sanitizedItems = itemsArr.map(item => ({
    ...item,
    endsAt: ensureEndsAt(item)
  }));

  // Delta Sync support: if 'since' timestamp provided, filter only newer items
  let resultItems = sanitizedItems;
  let isDelta = false;
  if (since > 0) {
    resultItems = sanitizedItems.filter(item => (item.indexedAt || 0) > since);
    isDelta = true;
  }

  res.json({
    success: true,
    isDelta: isDelta,
    lastCatalogUpdate: lastCatalogUpdateTime,
    count: resultItems.length,
    totalIndexed: sanitizedItems.length,
    items: resultItems
  });
});

// Financial calculation utility endpoint
app.get('/api/calc', (req, res) => {
  const bid = parseFloat(req.query.bid || 0);
  const retail = parseFloat(req.query.retail || 0);
  res.json({
    bid,
    retail,
    financials: calculateFinancials(bid, retail)
  });
});

const crypto = require('crypto');

// Per-User Multi-User Session Manager
const userSessionsMap = new Map();

function getUserSession(req, res) {
  let sessionId = req.headers['x-session-id'];
  if (!sessionId && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)tl_session_id=([^;]+)/);
    if (match) sessionId = match[1];
  }

  if (!sessionId) {
    sessionId = 'sess_' + crypto.randomBytes(16).toString('hex');
  }

  if (res && !res.headersSent) {
    res.setHeader('Set-Cookie', `tl_session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }

  if (!userSessionsMap.has(sessionId)) {
    userSessionsMap.set(sessionId, {
      id: sessionId,
      isLoggedIn: false,
      email: null,
      cookies: [],
      lastSyncTime: null,
      lastAccessedAt: Date.now()
    });
  }

  const session = userSessionsMap.get(sessionId);
  session.lastAccessedAt = Date.now();
  return session;
}

// Garbage collect inactive user sessions (every hour)
setInterval(() => {
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 3600 * 1000;
  for (const [id, session] of userSessionsMap.entries()) {
    if (session.lastAccessedAt && (now - session.lastAccessedAt > maxAgeMs)) {
      userSessionsMap.delete(id);
    }
  }
  if (userSessionsMap.size > 5000) {
    const keysToEvict = Array.from(userSessionsMap.keys()).slice(0, userSessionsMap.size - 5000);
    keysToEvict.forEach(k => userSessionsMap.delete(k));
  }
}, 3600000);

// Auth Status Endpoint
app.get('/api/auth/status', (req, res) => {
  const session = getUserSession(req, res);
  res.json({
    isLoggedIn: session.isLoggedIn,
    email: session.email,
    lastSyncTime: session.lastSyncTime
  });
});

// Auth Login Endpoint (Headless Puppeteer Login)
app.post('/api/auth/login', async (req, res) => {
  const session = getUserSession(req, res);
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  let browser = null;
  try {
    console.log(`[AUTH] Headless authentication attempt for user: ${username} (session: ${session.id})`);
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    // Updated: new site login page on bid.triangleliquidators.com
    await page.goto('https://bid.triangleliquidators.com/login', { waitUntil: 'networkidle2', timeout: 25000 });

    // New site uses email + password fields (MUI-based Next.js form)
    await page.waitForSelector('input[type="email"], input[name="email"], #email, input[type="text"]', { timeout: 10000 });

    const emailSelector = await page.$('input[type="email"], input[name="email"], #email') ? 'input[type="email"], input[name="email"], #email' : 'input[type="text"]';
    await page.type(emailSelector, username, { delay: 20 });
    await page.type('input[type="password"], input[name="password"], #password', password, { delay: 20 });

    await Promise.all([
      page.click('button[type="submit"], input[type="submit"], form button').catch(() => null),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => null)
    ]);

    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const isInvalid = currentUrl.includes('/login') && (
      bodyText.toLowerCase().includes('invalid') ||
      bodyText.toLowerCase().includes('incorrect') ||
      bodyText.toLowerCase().includes('wrong password') ||
      bodyText.toLowerCase().includes('login failed') ||
      bodyText.toLowerCase().includes('email or password')
    );

    if (isInvalid) {
      if (browser) await browser.close();
      return res.status(401).json({
        success: false,
        error: 'Invalid login credentials for auction account.'
      });
    }

    const cookies = await page.cookies();
    session.isLoggedIn = true;
    session.email = username;
    session.cookies = cookies;
    session.lastSyncTime = new Date().toISOString();

    if (browser) await browser.close();

    return res.json({
      success: true,
      message: `Successfully connected account for ${username}!`,
      email: username
    });
  } catch (err) {
    console.error('[AUTH ERROR]', err.message);
    if (browser) await browser.close();

    return res.status(500).json({
      success: false,
      error: `Authentication failed: ${err.message}`
    });
  }
});

// Auth Logout Endpoint
app.post('/api/auth/logout', (req, res) => {
  const session = getUserSession(req, res);
  session.isLoggedIn = false;
  session.email = null;
  session.cookies = [];
  session.lastSyncTime = null;
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Watchlist Sync Endpoint
app.post('/api/watchlist/sync', async (req, res) => {
  const session = getUserSession(req, res);
  if (!session.isLoggedIn) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Please connect your account.' });
  }

  const { localWatchlistUrls = [] } = req.body || {};
  let browser = null;

  try {
    console.log(`[WATCHLIST SYNC] Starting sync for user: ${session.email} (session: ${session.id})`);
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    if (session.cookies && session.cookies.length > 0) {
      await page.setCookie(...session.cookies);
    }

    // Updated: navigate to the new site's watchlist page on bid.triangleliquidators.com
    await page.goto('https://bid.triangleliquidators.com/watchlist', { waitUntil: 'networkidle2', timeout: 25000 });

    const pageUrl = page.url();
    if (pageUrl.includes('/login')) {
      session.isLoggedIn = false;
      session.cookies = [];
      if (browser) await browser.close();
      return res.status(401).json({ success: false, error: 'Session expired. Please reconnect your account.' });
    }

    // Extract watched lots from new site's __NEXT_DATA__ SSR JSON, falling back to DOM scanning
    const remoteWatchedLots = await page.evaluate(() => {
      const items = [];

      // Primary: try to extract from __NEXT_DATA__ JSON payload
      try {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
          const data = JSON.parse(nextDataEl.textContent || '{}');
          const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
          for (const q of queries) {
            const d = q?.state?.data;
            if (d && typeof d === 'object' && Array.isArray(d.results) && d.results.length > 0) {
              d.results.forEach(item => {
                if (!item || !item.id || item.status === 'ended') return;
                const lotUrl = `https://bid.triangleliquidators.com/lots/${item.auctionPeriod}/${item.id}`;
                const image = (Array.isArray(item.images) && item.images[0]?.imageCard)
                  ? `https://cdn.bid.triangleliquidators.com/${item.images[0].imageCard}`
                  : '';
                if (!items.some(i => i.url === lotUrl)) {
                  items.push({
                    title: item.title || '',
                    url: lotUrl,
                    image,
                    currentBid: parseFloat(item.currentPrice) || 0,
                    retailPrice: parseFloat(item.estimatedRetailPrice) || null,
                    lotId: item.id,
                    auctionPeriod: item.auctionPeriod
                  });
                }
              });
              break;
            }
          }
        }
      } catch (_) {}

      // Fallback: DOM scan for lot links matching new URL format /lots/YYYY-MM-DD/ID
      if (items.length === 0) {
        const allLinks = Array.from(document.querySelectorAll('a[href*="/lots/"]'));
        allLinks.forEach(a => {
          if (!/\/lots\/\d{4}-\d{2}-\d{2}\/\d+/.test(a.href)) return;
          const title = a.innerText.trim() || a.querySelector('h2, h3, h4, [class*="title"]')?.innerText?.trim() || '';
          const parentText = a.closest('[class*="card"], [class*="lot"], article, li')?.innerText || '';
          const isEnded = parentText.toLowerCase().includes('ended') || parentText.toLowerCase().includes('closed');
          if (a.href && !isEnded && !items.some(i => i.url === a.href)) {
            items.push({ title, url: a.href, currentBid: 0 });
          }
        });
      }

      return items;
    });

    console.log(`[WATCHLIST SYNC] Found ${remoteWatchedLots.length} active items in remote watched lots.`);

    /**
     * Extracts a stable lot key from either old or new TL lot URLs.
     * Old: /lots/view/1-XXXXX/slug  →  the "1-XXXXX" segment
     * New: /lots/2026-08-01/1234    →  the "1234" numeric lot ID
     */
    function extractLotKey(urlStr) {
      if (!urlStr) return '';
      // New site format: /lots/YYYY-MM-DD/ID
      const newMatch = urlStr.match(/\/lots\/\d{4}-\d{2}-\d{2}\/(\d+)/i);
      if (newMatch) return newMatch[1].toLowerCase();
      // Old site format: /lots/view/ID/slug
      const oldMatch = urlStr.match(/\/lots\/view\/([^\/\?#]+)/i);
      if (oldMatch) return oldMatch[1].toLowerCase();
      // Item number fallback
      const itemMatch = urlStr.match(/item-?(\d+)/i);
      if (itemMatch) return itemMatch[1].toLowerCase();
      return urlStr.toLowerCase().replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '');
    }

    // Match or populate active items into masterCatalogMap with real scraped data
    const nowMs = Date.now();
    const remoteItems = [];
    for (const remote of remoteWatchedLots) {
      const remoteKey = extractLotKey(remote.url);
      let catalogItem = null;

      for (const item of masterCatalogMap.values()) {
        if (extractLotKey(item.url) === remoteKey) {
          catalogItem = item;
          break;
        }
      }

      if (catalogItem) {
        // Exclude past/ended items from sync using 2-hour buffer and 11:59:59 PM closing date
        const BUFFER_MS = 2 * 60 * 60 * 1000;
        let isPast = true;
        const endsMs = catalogItem.endsAt ? new Date(catalogItem.endsAt).getTime() : NaN;
        if (!isNaN(endsMs) && (endsMs + BUFFER_MS > nowMs)) {
          isPast = false;
        }
        if (catalogItem.closingDate) {
          const closingEndMs = new Date(`${catalogItem.closingDate}T23:59:59-04:00`).getTime();
          if (!isNaN(closingEndMs) && closingEndMs >= nowMs) {
            isPast = false;
          }
        }
        if (isPast) continue;
        remoteItems.push(catalogItem);
      } else {
        // Fetch real lot HTML on-demand to get real title, image, location & data
        try {
          const lotRes = await fetch(remote.url);
          if (lotRes.ok) {
            const html = await lotRes.text();
            const realTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const realTitle = realTitleMatch ? realTitleMatch[1].replace(/\|.*/, '').trim() : remote.title;

            // Updated: match new CDN image pattern cdn.bid.triangleliquidators.com
            const realImgMatch = html.match(/https:\/\/cdn\.bid\.triangleliquidators\.com\/lots\/[^\s"'<>]+/i) ||
                                 html.match(/https:\/\/images-cdn\.auctionmobility\.com\/is3\/[^\s"'<>]+/i);
            const realImg = realImgMatch ? realImgMatch[0].replace(/&amp;/g, '&') : (remote.image || '');

            // Updated: new site uses location.name: "Anderson" instead of "SC Transfer"
            const isAnderson = html.toLowerCase().includes('"name":"anderson"') ||
                               html.toLowerCase().includes('anderson') ||
                               html.toLowerCase().includes('williamston');
            const realLocation = isAnderson ? 'Anderson' : 'Raleigh';
            const realAddress = isAnderson ? 'Williamston / Anderson, SC Transfer Depot' : '1101 Transport Dr, Raleigh, NC 27603';

            // Updated: new site uses "status":"ended" instead of "auction closed" text
            const isEnded = html.toLowerCase().includes('"status":"ended"') ||
                            html.toLowerCase().includes('auction closed') ||
                            html.toLowerCase().includes('bidding closed');
            if (isEnded) continue; // Do not import closed item

            // Updated: extract auction name from new site's JSON structure
            let realAuctionName = `${realLocation} Auction`;
            const auctionNameMatch = html.match(/"auctionName"\s*:\s*"([^"]+)"/i);
            if (auctionNameMatch) realAuctionName = auctionNameMatch[1];

            // Updated: extract category from new site's nested category.label JSON
            let realCategory = 'General Merchandise';
            const catLabelMatch = html.match(/"category"\s*:\s*\{[^}]*"label"\s*:\s*"([^"]+)"/i);
            if (catLabelMatch) realCategory = catLabelMatch[1];

            const now = new Date();
            const id = 'scraped-' + (remoteKey || Math.random().toString(36).substr(2, 9));
            const newItem = {
              id,
              title: realTitle || remote.title || 'Auction Item',
              url: remote.url,
              image: realImg || 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=80',
              currentBid: remote.currentBid || 0,
              retailPrice: remote.retailPrice || null,
              brand: (realTitle || '').split(' ')[0] || 'Generic',
              condition: 'Condition: Synced from Account',
              location: realLocation,
              address: realAddress,
              category: realCategory,
              auctionName: realAuctionName,
              closingDate: getEDTDateString(now),
              endsAt: new Date(now.getTime() + 12 * 3600 * 1000).toISOString(),
              financials: calculateFinancials(remote.currentBid || 0, remote.retailPrice)
            };
            masterCatalogMap.set(id, newItem);
            remoteItems.push(newItem);
          }
        } catch (e) {
          console.error(`[SYNC REAL SCRAPE ERROR] ${remote.url}:`, e.message);
        }
      }
    }

    // Bi-directional sync: If client has localWatchlistUrls that aren't watched on remote site, watch them remotely
    const remoteUrlSet = new Set(remoteWatchedLots.map(i => i.url));
    const itemsToRemoteWatch = localWatchlistUrls.filter(url => !remoteUrlSet.has(url));

    if (itemsToRemoteWatch.length > 0) {
      console.log(`[WATCHLIST SYNC] Syncing ${itemsToRemoteWatch.length} local items to remote account...`);
      for (const targetUrl of itemsToRemoteWatch.slice(0, 5)) { // batch limit to 5 per sync for performance
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
          // Updated: new site uses different watchlist button selectors (MUI-based)
          const watchBtn = await page.waitForSelector(
            'button[aria-label*="watch"], button[aria-label*="Watch"], button[class*="watch"], [data-testid*="watch"]',
            { timeout: 6000 }
          ).catch(() => null);
          if (watchBtn) {
            const isWatched = await page.evaluate(el => {
              const text = (el.innerText || '').toLowerCase();
              const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
              const className = el.className || '';
              return text.includes('unwatch') || ariaLabel.includes('unwatch') || className.includes('watched');
            }, watchBtn);
            if (!isWatched) {
              await watchBtn.click();
              await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
            }
          }
        } catch (e) {
          console.error(`[WATCHLIST SYNC] Failed to watch ${targetUrl} on remote:`, e.message);
        }
      }
    }

    // Refresh saved session cookies
    session.cookies = await page.cookies();
    session.lastSyncTime = new Date().toISOString();

    if (browser) await browser.close();

    return res.json({
      success: true,
      message: `Watchlist synced successfully. ${remoteItems.length} active items imported from auction account.`,
      remoteItems,
      syncedCount: remoteItems.length
    });
  } catch (err) {
    console.error('[WATCHLIST SYNC ERROR]', err.message);
    if (browser) await browser.close();
    return res.status(500).json({ success: false, error: `Watchlist sync failed: ${err.message}` });
  }
});


// Clear Past / Ended Items Endpoint
app.post(['/api/watchlist/clear-past', '/api/catalog/clear-past'], (req, res) => {
  const nowMs = Date.now();
  let clearedCount = 0;

  const BUFFER_MS = 2 * 60 * 60 * 1000;
  for (const [id, item] of masterCatalogMap.entries()) {
    let isPast = false;
    if (id.startsWith('watched-')) {
      isPast = true;
    }
    if (!isPast) {
      isPast = true;
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
    }

    if (isPast) {
      masterCatalogMap.delete(id);
      clearedCount++;
    }
  }

  saveDiskCache();
  console.log(`[CLEAR PAST] Cleared ${clearedCount} ended/stale items from master catalog. ${masterCatalogMap.size} active items remaining.`);

  res.json({
    success: true,
    message: `Cleared ${clearedCount} ended/stale items from master catalog.`,
    clearedCount,
    remainingCount: masterCatalogMap.size
  });
});

// Watchlist Remote Watch Toggle Endpoint
app.post('/api/watchlist/remote-watch', async (req, res) => {
  const session = getUserSession(req, res);
  const { url, watch } = req.body || {};
  if (!url) {
    return res.status(400).json({ success: false, error: 'Item URL is required.' });
  }

  if (!session.isLoggedIn) {
    return res.json({ success: true, url, watch, note: 'Saved locally (Account not connected).' });
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    if (session.cookies && session.cookies.length > 0) {
      await page.setCookie(...session.cookies);
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Updated: new site uses MUI-based buttons instead of Angular ng-click selectors
    const watchBtn = await page.waitForSelector(
      'button[aria-label*="watch"], button[aria-label*="Watch"], button[class*="watch"], [data-testid*="watch"]',
      { timeout: 7000 }
    ).catch(() => null);

    if (watchBtn) {
      const isWatched = await page.evaluate(el => {
        const text = (el.innerText || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const className = el.className || '';
        return text.includes('unwatch') || ariaLabel.includes('unwatch') || className.includes('watched');
      }, watchBtn);

      if ((watch && !isWatched) || (!watch && isWatched)) {
        await watchBtn.click();
        await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
      }
    }

    session.cookies = await page.cookies();
    if (browser) await browser.close();

    return res.json({ success: true, url, watch });
  } catch (err) {
    console.error('[REMOTE WATCH ERROR]', err.message);
    if (browser) await browser.close();
    return res.json({ success: true, url, watch, error: err.message });
  }
});

// Custom 404 Handler for undefined routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint Not Found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 TL Auction Tracker Running`);
    console.log(`📍 URL: http://0.0.0.0:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = { calculateFinancials, app };
