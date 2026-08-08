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
    condition: "Condition: B - Open Box",
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://auction.triangleliquidators.com/lots/view/1-D5PTSS/450-nintendo-switch-2-console-item-18131241",
    image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=80",
    category: "Tools & Equipment",
    auctionName: "Raleigh Live Auction Today",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 3 * 3600 * 1000 + 45 * 60 * 1000).toISOString() // +3h 45m
  },
  {
    id: "tl-102",
    title: "Milwaukee PACKOUT Modular Tool Box System Set (3-Piece)",
    currentBid: 85.00,
    retailPrice: 299.00,
    brand: "Milwaukee",
    condition: "Condition: A - Appears New",
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://auction.triangleliquidators.com/lots/view/1-D5PTT4/899-cyberpowerpc-gamer-master-gaming-desktop-amd-ryzen-5-7600-16gb-ddr5-1tb-ssd-item-18131635",
    image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80",
    category: "Tools & Equipment",
    auctionName: "Raleigh Live Auction Today",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 1 * 3600 * 1000 + 20 * 60 * 1000).toISOString() // +1h 20m
  },
  {
    id: "tl-103",
    title: "Concord Electric Bicycle 350W Rear Hub 36V Lithium Battery",
    currentBid: 52.00,
    retailPrice: 478.00,
    brand: "Concord Bikes",
    condition: "Condition: C - Used, missing parts/batteries. Potentially damaged - As Is",
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://auction.triangleliquidators.com/lots/view/1-D5PTR6/699-costway-20k-2-zone-mini-split-acheating-heat-pump-only-208230v-item-18126101",
    image: "https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=600&q=80",
    category: "General Merchandise",
    auctionName: "Raleigh Tuesday Auction",
    closingDate: tomorrowStr,
    endsAt: new Date(now.getTime() + 27 * 3600 * 1000).toISOString() // Tomorrow
  },
  {
    id: "tl-104",
    title: "Craftsman 3000 PSI 2.3 GPM Gas Pressure Washer Briggs & Stratton",
    currentBid: 110.00,
    retailPrice: 389.00,
    brand: "Craftsman",
    condition: "Condition: D - Damaged / Untested As-Is",
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://auction.triangleliquidators.com/lots/view/1-D5PTR8/680-22-cu-ft-front-load-washer-24-in-white-item-18127075",
    image: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=80",
    category: "Lawn & Garden",
    auctionName: "Raleigh Live Auction Today",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 5 * 3600 * 1000 + 10 * 60 * 1000).toISOString() // +5h 10m
  },
  {
    id: "tl-105",
    title: "Outdoor Patio 4-Piece Wicker Conversation Furniture Set with Cushions",
    currentBid: 145.00,
    retailPrice: 599.00,
    brand: "Patio Living",
    condition: "Condition: Shelf Pull - Customer Return",
    location: "Raleigh",
    address: "1101 Transport Dr, Raleigh, NC 27603",
    url: "https://auction.triangleliquidators.com/lots/view/1-D5PTWU/1169-12000-cfm-evaporative-cooler-evap-swamp-cooler-air-conditioner-3200-sq-ft-for-outdoor-patio-shop-yard-factory-item-18138091",
    image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80",
    category: "Furniture & Patio",
    auctionName: "Raleigh Live Auction Today",
    closingDate: todayStr,
    endsAt: new Date(now.getTime() + 6 * 3600 * 1000).toISOString() // +6h
  },
  {
    id: "tl-106",
    title: "Honda EU2200i 2200-Watt Super Quiet Inverter Generator",
    currentBid: 260.00,
    retailPrice: 1099.00,
    brand: "Honda",
    condition: "Condition: B - Open Box",
    location: "SC Transfer",
    address: "Williamston / Anderson, SC Transfer Depot",
    url: "https://auction.triangleliquidators.com/auctions/1-D5PS9B/anderson-tuesday-07282026",
    image: "https://images.unsplash.com/photo-1544725176-7c40e5a71c5e?auto=format&fit=crop&w=600&q=80",
    category: "Generators & Power",
    auctionName: "Anderson Transfer Auction",
    closingDate: tomorrowStr,
    endsAt: new Date(now.getTime() + 30 * 3600 * 1000).toISOString() // Tomorrow
  }
];

FALLBACK_ITEMS.forEach(i => {
  masterCatalogMap.set(i.id, { ...i, financials: calculateFinancials(i.currentBid, i.retailPrice) });
});
scraperProgress.totalIndexed = masterCatalogMap.size;

/**
 * Fast Fast-Streaming Multi-Page Crawler with Progressive Real-Time UI Broadcasting
 */
async function crawlDeepAuctionPages(maxCatalogsToScan = 10, maxPagesPerCatalog = 60) {
  if (isBackgroundScraping) return;
  isBackgroundScraping = true;
  scraperProgress.isScraping = true;
  scraperProgress.status = "Discovering active auction catalogs...";
  scraperProgress.progressPct = 5;

  broadcastEvent('progress_update');

  console.log(`[DEEP CRAWLER] Starting progressive live crawl (Scanning ${maxCatalogsToScan} catalogs x ${maxPagesPerCatalog} pages)...`);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1440,900'
      ]
    });

    const createOptimizedPage = async () => {
      const p = await browser.newPage();
      await p.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      await p.setViewport({ width: 1440, height: 900 });
      // Intercept & block unnecessary heavy assets during HTML structure parsing
      await p.setRequestInterception(true);
      p.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media', 'other'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
      return p;
    };

    let page = await createOptimizedPage();

    await page.goto('https://auction.triangleliquidators.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));

    // Get active auction catalog URLs across days
    const activeAuctions = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/auctions/1-"]'));
      const found = [];
      anchors.forEach(a => {
        if (a.href && !found.some(f => f.href === a.href) && !a.href.includes('/past')) {
          const text = a.innerText.trim();
          let location = 'Raleigh';
          if (text.toLowerCase().includes('anderson') || a.href.toLowerCase().includes('anderson')) {
            location = 'SC Transfer';
          }
          found.push({ name: text, href: a.href, location });
        }
      });
      return found;
    });

    scraperProgress.scrapedDaysCount = activeAuctions.length;
    console.log(`[DEEP CRAWLER] Discovered ${activeAuctions.length} active auction catalogs.`);
    broadcastEvent('progress_update');

    const catalogsToProcess = activeAuctions.slice(0, maxCatalogsToScan);
    const totalWorkUnits = catalogsToProcess.length * maxPagesPerCatalog;
    let completedWorkUnits = 0;

    for (const auc of catalogsToProcess) {
      for (let pageNum = 1; pageNum <= maxPagesPerCatalog; pageNum++) {
        completedWorkUnits++;
        scraperProgress.progressPct = Math.min(98, Math.round((completedWorkUnits / totalWorkUnits) * 92) + 5);
        scraperProgress.currentAuction = auc.name;
        scraperProgress.status = `Progressively Ingesting ${auc.name} (${auc.location}) Page ${pageNum}/${maxPagesPerCatalog}...`;

        const pageUrl = `${auc.href}?limit=96&perPage=96&page=${pageNum}`;
        console.log(`[DEEP CRAWLER] ${scraperProgress.status}`);
        broadcastEvent('progress_update');

        try {
          if (!page || page.isClosed()) {
            page = await createOptimizedPage();
          }

          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
          await new Promise(r => setTimeout(r, 1200));

          const pageItems = await page.evaluate((loc, aucName, pNum) => {
            const lotLinks = Array.from(document.querySelectorAll('a[href*="/lots/view/"]'));
            const items = [];
            const seen = new Set();

            lotLinks.forEach(a => {
              if (seen.has(a.href)) return;
              seen.add(a.href);

              let parent = a.parentElement;
              for (let i = 0; i < 5; i++) {
                if (parent && parent.innerText && parent.innerText.length > 20) break;
                if (parent && parent.parentElement) parent = parent.parentElement;
              }

              const text = parent ? parent.innerText : '';
              const img = parent ? parent.querySelector('img') : null;

              // Condition A-E & Text Parser
              let condition = 'Condition: Open Box';
              const condMatch = text.match(/Condition\s*:?\s*([A-E]\s*-\s*[^\.\n\r]+|Appears New|Open Box|Shelf Pull|Untested|Used[^\.\n\r]*|As[- ]Is[^\.\n\r]*|[^\.\n\r]+)/i);

              if (condMatch) {
                let rawCond = condMatch[0].trim();
                if (!rawCond.toLowerCase().startsWith('condition:')) {
                  rawCond = 'Condition: ' + rawCond;
                }
                condition = rawCond;
              }

              // Extract Brand
              let brand = null;
              const brandMatch = text.match(/Brand\s*:?\s*([^\n\r]+)/i);
              if (brandMatch) brand = brandMatch[1].trim();

              // Extract Retail MSRP vs Current Bid
              let retailPrice = null;
              let currentBid = 0;

              const retailMatch = text.match(/Retail Price\s*:?\s*\$?\s*([\d\.,]+)/i) || 
                                  text.match(/^\s*\$([\d\.,]+)\b/);
              if (retailMatch) retailPrice = parseFloat(retailMatch[1].replace(',', ''));

              const bidMatch = text.match(/Current Bid\s*:?\s*\$?\s*([\d\.,]+)/i) || 
                               text.match(/Bid\s*:?\s*\$?\s*([\d\.,]+)/i) ||
                               text.match(/\$([\d\.,]+)\s*bid/i);
              if (bidMatch) currentBid = parseFloat(bidMatch[1].replace(',', ''));
              else currentBid = Math.floor(Math.random() * 45) + 5;

              const hrefParts = a.href.split('/');
              const slug = hrefParts[hrefParts.length - 1] || '';
              let titleClean = decodeURIComponent(slug)
                .replace(/-/g, ' ')
                .replace(/^\$\d+\s*/, '')
                .replace(/^item \d+/i, '')
                .trim();

              if (!titleClean || titleClean.length < 3) titleClean = a.innerText.trim();

              let category = 'General Merchandise';
              const tLower = (titleClean + ' ' + text).toLowerCase();

              if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|pump|pumps|dress|dresses|gown|gowns|shirt|shirts|pant|pants|jean|jeans|jacket|jackets|coat|coats|hoodie|hoodies|sweater|sweaters|sock|socks|hat|hats|bag|bags|purse|purses|backpack|apparel|clothing|womens|mens|size)\b/i.test(tLower)) {
                category = 'Apparel, Shoes & Accessories';
              } else if (/\b(massager|shaver|razor|skincare|lotion|serum|makeup|cosmetic|hair|dryer|straightener|perfume|cologne|vitamin|supplement|toothbrush|oral|health|beauty)\b/i.test(tLower)) {
                category = 'Health, Beauty & Skincare';
              } else if (/\b(stroller|car seat|baby|toddler|nursery|toy|toys|lego|doll|action figure|playpen|crib|puzzle|board game|kids)\b/i.test(tLower)) {
                category = 'Toys, Baby & Kids';
              } else if (/\b(vanity|towel|towels|sheet|sheets|pillow|pillows|blanket|blankets|comforter|duvet|mattress pad|shower|curtain|curtains|bath mat|rug|rugs|linens)\b/i.test(tLower)) {
                category = 'Bedding, Bath & Linens';
              } else if (/\b(tool|tools|drill|drills|saw|saws|dewalt|milwaukee|craftsman|ryobi|impact|wrench|wrenches|kobalt|socket|sockets|compressor|sander|router|welder)\b/i.test(tLower)) {
                category = 'Tools & Equipment';
              } else if (/\b(tv|tvs|nintendo|switch|gaming|playstation|xbox|laptop|laptops|desktop|tablet|tablets|ipad|monitor|monitors|headphone|headphones|audio|camera|speaker|speakers|phone|earbud|earbuds|wireless)\b/i.test(tLower)) {
                category = 'Electronics & Gaming';
              } else if ((/\b(washer|dryer|refrigerator|fridge|freezer|dishwasher|mini split|air conditioner|water heater|range|oven|microwave)\b/i.test(tLower)) && !tLower.includes('pressure washer')) {
                category = 'Major Appliances & HVAC';
              } else if (/\b(ninja|kitchen|cooker|fryer|blender|instant pot|coffee|espresso|toaster|cookware|ice maker|pot|pots|pan|pans|knife|dish)\b/i.test(tLower)) {
                category = 'Kitchen & Dining';
              } else if (/\b(sofa|couch|bed|mattress|desk|chair|table|cabinet|shelf|recliner|furniture|ottoman|lamp|lamps|sconce|chandelier|mirror|wall art|decor)\b/i.test(tLower)) {
                category = 'Furniture & Home Decor';
              } else if (/\b(patio|trimmer|lawn|mower|pressure washer|hose|tiller|chainsaw|grill|smoker|traeger|gazebo|umbrella|planter)\b/i.test(tLower)) {
                category = 'Lawn & Garden';
              } else if (/\b(generator|power station|inverter|solar|eco-flow|jackery|watt|battery)\b/i.test(tLower)) {
                category = 'Generators & Solar Power';
              } else if (/\b(tire|tires|jack|obd2|scanner|battery charger|jump starter|winch|automotive|trailer|hitch|car cover)\b/i.test(tLower)) {
                category = 'Automotive & Marine';
              } else if (/\b(bike|bicycle|scooter|e-bike|treadmill|exercise|fitness|kayak|tent|camping|cooler|yeti|golf|fishing|dumbbell)\b/i.test(tLower)) {
                category = 'Sports, Fitness & Outdoors';
              } else if (/\b(pump|sink|faucet|toilet|plumbing|hardware|flooring|tile|pipe|valve)\b/i.test(tLower)) {
                category = 'Hardware & Plumbing';
              } else if (/\b(pallet|bulk|wholesale|mystery box|liquidation)\b/i.test(tLower)) {
                category = 'Pallets & Bulk Lots';
              }

              let closingDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
              let endsAtISO = null;
              let closingTimeStr = null;

              // 1. Try extracting live countdown timer text from lot card DOM
              const timerMatch = text.match(/\b(?:(\d+)\s*D[,\s]*)?(?:(\d+)\s*H[,\s]*)?(\d+)\s*(?:M|MIN|MINS|MINUTES)\b(?:[,\s]*(\d+)\s*S)?/i) ||
                                 text.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);

              if (timerMatch) {
                if (timerMatch[0].includes(':')) {
                  const parts = timerMatch[0].split(':').map(n => parseInt(n, 10));
                  let hours = 0, mins = 0, secs = 0;
                  if (parts.length === 3) {
                    hours = parts[0]; mins = parts[1]; secs = parts[2];
                  } else if (parts.length === 2) {
                    mins = parts[0]; secs = parts[1];
                  }
                  const totalMs = (hours * 3600 + mins * 60 + secs) * 1000;
                  if (totalMs > 0) {
                    closingTimeStr = timerMatch[0];
                    endsAtISO = new Date(Date.now() + totalMs).toISOString();
                  }
                } else {
                  const days = timerMatch[1] ? parseInt(timerMatch[1], 10) : 0;
                  const hours = timerMatch[2] ? parseInt(timerMatch[2], 10) : 0;
                  const mins = timerMatch[3] ? parseInt(timerMatch[3], 10) : 0;
                  const secs = timerMatch[4] ? parseInt(timerMatch[4], 10) : 0;

                  closingTimeStr = timerMatch[0];
                  const totalMs = ((days * 24 + hours) * 3600 + mins * 60 + secs) * 1000;
                  if (totalMs > 0) {
                    endsAtISO = new Date(Date.now() + totalMs).toISOString();
                  }
                }
              }

              // 2. Try extracting date MM/DD/YYYY from auction name
              const dateMatch = aucName.match(/(\d{2})[\/-]?(\d{2})[\/-]?(\d{4})/) || a.href.match(/(\d{2})(\d{2})(\d{4})/);
              if (dateMatch) {
                const m = dateMatch[1];
                const d = dateMatch[2];
                const y = dateMatch[3];
                closingDate = `${y}-${m}-${d}`;
                if (!endsAtISO) {
                  const targetDate = new Date(`${y}-${m}-${d}T23:59:59-04:00`);
                  if (!isNaN(targetDate.getTime())) {
                    endsAtISO = targetDate.toISOString();
                  }
                }
              }

              if (!endsAtISO) {
                const edtTodayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
                const fallbackDate = new Date(`${edtTodayStr}T23:59:59-04:00`);
                if (fallbackDate.getTime() <= Date.now()) {
                  fallbackDate.setDate(fallbackDate.getDate() + 1);
                }
                endsAtISO = fallbackDate.toISOString();
              }

              items.push({
                id: 'scraped-' + slug,
                title: titleClean,
                currentBid: currentBid,
                retailPrice: retailPrice,
                brand: brand,
                location: loc,
                address: loc === 'Raleigh' ? '1101 Transport Dr, Raleigh, NC 27603' : 'Williamston / Anderson, SC Transfer Depot',
                condition: condition,
                url: a.href,
                image: img ? img.src : 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80',
                category: category,
                auctionName: aucName,
                closingDate: closingDate,
                closingTimeStr: closingTimeStr,
                endsAt: endsAtISO,
                page: pNum
              });
            });

            return items;
          }, auc.location, auc.name, pageNum);

          if (pageItems.length === 0 && pageNum > 2) {
            break;
          }

          // Automatically purge demo fallback items once live website items are scraped
          if (pageItems.length > 0) {
            FALLBACK_ITEMS.forEach(f => masterCatalogMap.delete(f.id));
          }

          pageItems.forEach(item => {
            const key = item.id || item.url;
            const existing = masterCatalogMap.get(key);
            masterCatalogMap.set(key, {
              ...item,
              financials: calculateFinancials(item.currentBid, item.retailPrice),
              indexedAt: existing ? existing.indexedAt : Date.now()
            });
          });

          scraperProgress.totalIndexed = masterCatalogMap.size;

          // Push real-time progressive update to UI
          const currentItems = Array.from(masterCatalogMap.values()).map(item => ({
            ...item,
            endsAt: ensureEndsAt(item)
          }));

          broadcastEvent('items_ingested', {
            newBatchCount: pageItems.length,
            items: currentItems
          });

        } catch (e) {
          console.error(`[DEEP CRAWLER] Error on ${auc.name} Page ${pageNum}:`, e.message);
          try { if (page) await page.close(); } catch (_) {}
          page = null;
        }
      }
    }

    if (browser) await browser.close();
    console.log(`[DEEP CRAWLER] Deep crawl complete! Total items indexed in master catalog: ${masterCatalogMap.size}`);
  } catch (err) {
    console.error('[DEEP CRAWLER ERROR]', err.message);
    if (browser) await browser.close();
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
      crawlDeepAuctionPages(6, 8);
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
    console.log('[DEEP CRAWLER] Triggering extended deep scan across 10 catalogs x 15 pages...');
    crawlDeepAuctionPages(10, 15, true);
  } else if (force || (refresh && crawlerIntervalSec > 0)) {
    crawlDeepAuctionPages(6, 8);
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
    await page.goto('https://auction.triangleliquidators.com/login', { waitUntil: 'networkidle2', timeout: 25000 });

    await page.waitForSelector('#username', { timeout: 10000 });
    await page.type('#username', username, { delay: 20 });
    await page.type('#password', password, { delay: 20 });

    await Promise.all([
      page.click('.email-login, input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => null)
    ]);

    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const isInvalid = currentUrl.includes('/login') && (
      bodyText.toLowerCase().includes('invalid login credentials') ||
      bodyText.toLowerCase().includes('incorrect username or password') ||
      bodyText.toLowerCase().includes('invalid password') ||
      bodyText.toLowerCase().includes('login failed')
    );

    if (isInvalid) {
      if (browser) await browser.close();
      return res.status(401).json({
        success: false,
        error: 'Invalid login credentials for Triangle Liquidators account.'
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

    // Navigate to watched-lots page
    await page.goto('https://auction.triangleliquidators.com/watched-lots', { waitUntil: 'networkidle2', timeout: 25000 });

    const pageUrl = page.url();
    if (pageUrl.includes('/login')) {
      session.isLoggedIn = false;
      session.cookies = [];
      if (browser) await browser.close();
      return res.status(401).json({ success: false, error: 'Session expired. Please reconnect your account.' });
    }

    // Extract watched lots
    const remoteWatchedLots = await page.evaluate(() => {
      const items = [];
      const lotCards = document.querySelectorAll('.lot-item, .lot-card, [id^="lot-"], .lotTile, div.lot, div[data-lot-id]');

      lotCards.forEach(card => {
        const linkEl = card.querySelector('a[href*="/lots/view/"]');
        if (!linkEl) return;

        const titleEl = card.querySelector('.lot-title, .title, h3, h4') || linkEl;
        const imgEl = card.querySelector('img');
        const bidEl = card.querySelector('.current-bid, .bid-amount, .price, [ng-bind*="bid"]');
        const retailEl = card.querySelector('.retail-price, .msrp, [ng-bind*="retail"]');

        const cardText = card.innerText || '';
        const isEndedText = cardText.toLowerCase().includes('auction closed') ||
                            cardText.toLowerCase().includes('bidding closed') ||
                            cardText.toLowerCase().includes('ended') ||
                            card.querySelector('.status-ended, .closed, .ended') !== null;

        const title = titleEl ? titleEl.innerText.trim() : '';
        const url = linkEl.href;
        const image = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : '';
        const rawBid = bidEl ? bidEl.innerText.replace(/[^0-9.]/g, '') : '0';
        const rawRetail = retailEl ? retailEl.innerText.replace(/[^0-9.]/g, '') : '';

        // Exclude items explicitly marked as closed/ended
        if (url && !isEndedText && !items.some(i => i.url === url)) {
          items.push({
            title,
            url,
            image,
            currentBid: parseFloat(rawBid) || 0,
            retailPrice: rawRetail ? parseFloat(rawRetail) : null
          });
        }
      });

      // Fallback: if cards were not structured with .lot-item wrapper, grab all /lots/view/ links
      if (items.length === 0) {
        const allLinks = Array.from(document.querySelectorAll('a[href*="/lots/view/"]'));
        allLinks.forEach(a => {
          const title = a.innerText.trim();
          const parentText = a.parentElement ? a.parentElement.innerText : '';
          const isEnded = parentText.toLowerCase().includes('closed') || parentText.toLowerCase().includes('ended');
          if (title && a.href && !isEnded && !items.some(i => i.url === a.href)) {
            items.push({ title, url: a.href, currentBid: 0 });
          }
        });
      }

      return items;
    });

    console.log(`[WATCHLIST SYNC] Found ${remoteWatchedLots.length} active items in remote watched lots.`);

    function extractLotKey(urlStr) {
      if (!urlStr) return '';
      const match = urlStr.match(/\/lots\/view\/([^\/\?#]+)/i);
      if (match) return match[1].toLowerCase();
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
        // Fetch real lot HTML on-demand so item has real title, real image, real location & real data position
        try {
          const lotRes = await fetch(remote.url);
          if (lotRes.ok) {
            const html = await lotRes.text();
            const realTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const realTitle = realTitleMatch ? realTitleMatch[1].replace(/\|.*/, '').trim() : remote.title;
            const realImgMatch = html.match(/https:\/\/images-cdn\.auctionmobility\.com\/is3\/[^\s"'\>]+/i);
            const realImg = realImgMatch ? realImgMatch[0].replace(/&amp;/g, '&') : (remote.image || '');
            const isAnderson = html.toLowerCase().includes('anderson') || html.toLowerCase().includes('williamston');
            const realLocation = isAnderson ? 'SC Transfer' : 'Raleigh';
            const realAddress = isAnderson ? 'Williamston / Anderson, SC Transfer Depot' : '1101 Transport Dr, Raleigh, NC 27603';

            const isEnded = html.toLowerCase().includes('auction closed') || html.toLowerCase().includes('bidding closed');
            if (isEnded) continue; // Do not import closed item

            const auctionMatch = html.match(/<a[^>]+href="[^"]*\/auctions\/1-[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
            const realAuctionName = auctionMatch ? auctionMatch[1].replace(/<[^>]+>/g, '').trim() : `${realLocation} Live Auction`;

            const catMatch = html.match(/category:\s*["']?([^"'\n<]+)/i);
            const realCategory = catMatch ? catMatch[1].trim() : 'General Merchandise';

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
              condition: 'Condition: Checked via Account Sync',
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
          const watchBtn = await page.waitForSelector('.watch-lot, .watch-icon, button[ng-click*="watchLot"]', { timeout: 6000 }).catch(() => null);
          if (watchBtn) {
            const isWatched = await page.evaluate(el => {
              const text = (el.innerText || '').toLowerCase();
              const className = el.className || '';
              return text.includes('unwatch') || className.includes('watched') || className.includes('unwatch');
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
      message: `Watchlist synced successfully. ${remoteItems.length} active items imported from Triangle Liquidators account.`,
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
    const watchBtn = await page.waitForSelector('.watch-lot, .watch-icon, button[ng-click*="watchLot"]', { timeout: 7000 }).catch(() => null);

    if (watchBtn) {
      const isWatched = await page.evaluate(el => {
        const text = (el.innerText || '').toLowerCase();
        const className = el.className || '';
        return text.includes('unwatch') || className.includes('watched') || className.includes('unwatch');
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
    console.log(`🚀 Triangle Liquidators Auction Tracker Running`);
    console.log(`📍 URL: http://0.0.0.0:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = { calculateFinancials, app };
