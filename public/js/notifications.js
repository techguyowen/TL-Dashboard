/**
 * TL Auction Tracker - Notification Engine
 * Manages push alerts, sound chimes, webhook dispatching, and the notification drawer.
 */

let notificationsList = [];
let activeNotifFilter = 'all';
const seenNotifKeys = new Set();

function loadNotificationsFromStorage() {
  try {
    const raw = localStorage.getItem('tl_notifications_list');
    if (raw) {
      notificationsList = JSON.parse(raw);
    }
  } catch (e) {
    notificationsList = [];
  }
  updateNotifBadge();
}

function saveNotificationsToStorage() {
  localStorage.setItem('tl_notifications_list', JSON.stringify(notificationsList.slice(0, 100)));
  updateNotifBadge();
}

function updateNotifBadge() {
  const unreadCount = notificationsList.filter(n => !n.read).length;
  const badge = document.getElementById('notifBadge');
  const bellBtn = document.getElementById('notifBellBtn');
  const countLabel = document.getElementById('notifHeaderCount');

  if (badge) {
    if (unreadCount > 0) {
      badge.innerText = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  if (bellBtn) {
    if (unreadCount > 0) bellBtn.classList.add('has-unread');
    else bellBtn.classList.remove('has-unread');
  }

  if (countLabel) {
    countLabel.innerText = `${unreadCount} unread`;
  }
}

function addNotification(notif) {
  if (!notif || !notif.key) return;
  if (seenNotifKeys.has(notif.key)) return;
  seenNotifKeys.add(notif.key);

  const entry = Object.assign({
    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    timestamp: Date.now(),
    read: false
  }, notif);

  notificationsList.unshift(entry);
  saveNotificationsToStorage();

  // Play sound if enabled
  if (userPreferences.enableSounds) {
    if (notif.type === 'sniping') {
      playSnipingChime();
    } else {
      playDiscoveryChime();
    }
  }

  // Dispatch desktop push notification
  if (userPreferences.enablePush && Notification.permission === 'granted') {
    dispatchPushAlert(notif.title, notif.message, notif.url, notif.image);
  }

  // Forward to external webhook if configured
  if (userPreferences.webhookUrl) {
    sendWebhookNotification(notif);
  }

  renderNotificationDrawer();
}

function evaluateNotificationTriggers(items, isInitialLoad = false) {
  if (!Array.isArray(items) || items.length === 0) return;
  const now = Date.now();

  items.forEach(item => {
    if (!item.url) return;
    const fin = item.financials || calcFin(item.currentBid, item.retailPrice);
    const scoreObj = item.dealScore || calculateDealScore(item.currentBid, item.retailPrice, item.condition, item.brand);
    const watchMatch = isWatchlistMatch(item.title);

    // 1. Sniping Alert: Ending Soon (<15 minutes) with Active Deal
    if (userPreferences.alertEndingSoon && item.endsAt) {
      const endsMs = new Date(item.endsAt).getTime();
      const minsRemaining = (endsMs - now) / 60000;
      if (minsRemaining > 0 && minsRemaining <= 15) {
        const key = `sniping_${item.url}_15m`;
        if (!seenNotifKeys.has(key)) {
          if (!isInitialLoad) {
            addNotification({
              key,
              type: 'sniping',
              tag: 'Ending Soon',
              tagClass: 'ending',
              title: `Auction Closing in ${Math.ceil(minsRemaining)}m!`,
              message: `${item.title} — Current Bid: ${fin.bidFormatted}`,
              price: `Total: ${fin.totalCost}`,
              image: item.image,
              url: item.url
            });
          } else {
            seenNotifKeys.add(key);
          }
        }
      }
    }

    // 2. Epic Deal Score Alert (Score >= 85)
    if (userPreferences.alertDeals && scoreObj.score >= 85) {
      const key = `deal_${item.url}_score85`;
      if (!seenNotifKeys.has(key)) {
        if (!isInitialLoad) {
          addNotification({
            key,
            type: 'deals',
            tag: `${scoreObj.score} Deal Score`,
            tagClass: 'dealscore',
            title: `Epic Deal Discovered (${scoreObj.score}/100)`,
            message: `${item.title} — Save ${fin.savingsPct || 0}%`,
            price: `Total: ${fin.totalCost}`,
            image: item.image,
            url: item.url
          });
        } else {
          seenNotifKeys.add(key);
        }
      }
    }

    // 3. Watchlist Keyword Match Alert
    if (userPreferences.alertWatchlist && watchMatch) {
      const key = `watchlist_${item.url}`;
      if (!seenNotifKeys.has(key)) {
        if (!isInitialLoad) {
          addNotification({
            key,
            type: 'watchlist',
            tag: 'Watchlist Match',
            tagClass: 'watchlist',
            title: 'Watchlist Item Found',
            message: `${item.title}`,
            price: `Bid: ${fin.bidFormatted}`,
            image: item.image,
            url: item.url
          });
        } else {
          seenNotifKeys.add(key);
        }
      }
    }
  });
}

function renderNotificationDrawer() {
  const container = document.getElementById('notifList');
  if (!container) return;

  let filtered = notificationsList;
  if (activeNotifFilter !== 'all') {
    filtered = notificationsList.filter(n => n.type === activeNotifFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="notif-empty">
        <i class="fa-regular fa-bell-slash"></i>
        <div style="font-weight: 600; color: #cbd5e1;">No notifications yet</div>
        <div style="font-size: 0.78rem;">Deals, sniping alerts, and watchlist matches will appear here in real-time.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(notif => `
    <div class="notif-item ${notif.read ? '' : 'unread'}" onclick="handleNotifClick('${notif.id}', '${escapeHtml(notif.url)}')">
      <img src="${notif.image || '/favicon.svg'}" alt="" class="notif-img" onerror="this.src='/favicon.svg'" />
      <div class="notif-content">
        <div class="notif-item-header">
          <span class="notif-tag ${notif.tagClass || ''}">${escapeHtml(notif.tag || notif.type)}</span>
          <span class="notif-item-time">${formatNotifTime(notif.timestamp)}</span>
        </div>
        <div class="notif-item-title" title="${escapeHtml(notif.message)}">${escapeHtml(notif.message)}</div>
        <div class="notif-item-price">${escapeHtml(notif.price || '')}</div>
      </div>
    </div>
  `).join('');
}

function formatNotifTime(ts) {
  if (!ts) return '';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function toggleNotificationDrawer(forceState) {
  const drawer = document.getElementById('notifDrawer');
  if (!drawer) return;

  const shouldOpen = (typeof forceState === 'boolean') ? forceState : !drawer.classList.contains('open');
  if (shouldOpen) {
    drawer.classList.add('open');
    renderNotificationDrawer();
  } else {
    drawer.classList.remove('open');
  }
}

function setNotifFilter(filter, evt) {
  activeNotifFilter = filter;
  document.querySelectorAll('.notif-filter-pill').forEach(pill => pill.classList.remove('active'));
  if (evt && evt.target) evt.target.classList.add('active');
  renderNotificationDrawer();
}

function markAllNotificationsRead() {
  notificationsList.forEach(n => { n.read = true; });
  saveNotificationsToStorage();
  renderNotificationDrawer();
}

function clearAllNotifications() {
  notificationsList = [];
  saveNotificationsToStorage();
  renderNotificationDrawer();
}

function handleNotifClick(id, url) {
  const notif = notificationsList.find(n => n.id === id);
  if (notif) {
    notif.read = true;
    saveNotificationsToStorage();
    renderNotificationDrawer();
  }
  if (url) {
    window.open(url, '_blank');
  }
}

/**
 * BROWSER DESKTOP PUSH
 */
function requestPushPermission() {
  if (!('Notification' in window)) {
    alert('This browser does not support desktop notifications.');
    return;
  }
  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      userPreferences.enablePush = true;
      savePreferencesState();
      playSuccessChime();
      dispatchPushAlert('Notifications Activated', 'You will receive real-time deal and sniping alerts.', 'https://bid.triangleliquidators.com/');
    } else {
      userPreferences.enablePush = false;
      savePreferencesState();
    }
  });
}

function dispatchPushAlert(title, body, url, icon) {
  try {
    const push = new Notification(title, {
      body: body || 'New auction alert on TL Dashboard',
      icon: icon || '/favicon.svg',
      badge: '/favicon.svg'
    });
    push.onclick = () => {
      window.focus();
      if (url) window.open(url, '_blank');
    };
  } catch (e) {
    console.warn('[PUSH NOTIF] Dispatch error:', e);
  }
}

/**
 * EXTERNAL WEBHOOKS
 */
async function sendWebhookNotification(notif) {
  if (!userPreferences.webhookUrl) return;
  try {
    await fetch('/api/notifications/webhook-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: userPreferences.webhookUrl,
        payload: {
          title: notif.title,
          message: notif.message,
          price: notif.price,
          url: notif.url,
          timestamp: new Date().toISOString()
        }
      })
    });
  } catch (e) {
    console.warn('[WEBHOOK] Failed to forward notification:', e);
  }
}

async function testWebhookEndpoint() {
  const urlInput = document.getElementById('webhookUrlInput');
  const url = urlInput ? urlInput.value.trim() : '';
  if (!url) {
    alert('Please enter a Webhook URL first.');
    return;
  }

  try {
    const res = await fetch('/api/notifications/webhook-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: url })
    });
    const data = await res.json();
    if (data.success) {
      alert('Webhook test message sent successfully!');
    } else {
      alert('Webhook failed: ' + (data.error || 'Check URL'));
    }
  } catch (err) {
    alert('Webhook error: ' + err.message);
  }
}
