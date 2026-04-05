/**
 * NASA EONET Disaster Monitor — Nuri Plugin
 * No API key required. Free & open.
 * ~/.openclaw/plugins/disaster-monitor/index.js
 */

'use strict';

const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3/events';

// Cape Town coordinates
const CAPE_TOWN = { lat: -33.9249, lon: 18.4241 };
const ALERT_RADIUS_KM = 1000;

// Africa bounding box: lon -18 to 52, lat -36 to 38
// EONET bbox format: west,north,east,south
const AFRICA_BBOX = '-18,38,52,-36';

// ─────────────────────────────────────────────
// 1. FETCH CURRENT DISASTERS
// ─────────────────────────────────────────────

/**
 * Fetch open EONET events from the last N days.
 * @param {string[]} categories - EONET category IDs (empty = all)
 * @param {number}   days       - how many days back to look (default 7)
 */
async function getCurrentDisasters(categories = [], days = 7) {
  const params = new URLSearchParams({ status: 'open', days });
  if (categories.length) params.set('category', categories.join(','));

  const res = await fetch(`${EONET_BASE}?${params}`);
  if (!res.ok) throw new Error(`EONET fetch failed: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
// 2. FILTER BY AFRICA / SOUTH AFRICA BBOX
// ─────────────────────────────────────────────

/**
 * Fetch open events within the Africa bounding box.
 */
async function getAfricaDisasters(days = 7) {
  const params = new URLSearchParams({ bbox: AFRICA_BBOX, status: 'open', days });
  const res = await fetch(`${EONET_BASE}?${params}`);
  if (!res.ok) throw new Error(`EONET Africa fetch failed: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
// 3. DISTANCE HELPER (Haversine)
// ─────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Return the closest geometry point distance (km) from Cape Town for an event.
 * Events may have Point or Polygon geometry; we check all coordinates.
 */
function distanceFromCapeTown(event) {
  if (!event.geometry || event.geometry.length === 0) return Infinity;

  let minDist = Infinity;
  for (const geom of event.geometry) {
    const coords = geom.coordinates;
    if (!coords) continue;

    // Point: [lon, lat]
    if (geom.type === 'Point') {
      const d = haversineKm(CAPE_TOWN.lat, CAPE_TOWN.lon, coords[1], coords[0]);
      if (d < minDist) minDist = d;
    }
    // Polygon: [[[lon, lat], ...]]
    if (geom.type === 'Polygon') {
      for (const ring of coords) {
        for (const [lon, lat] of ring) {
          const d = haversineKm(CAPE_TOWN.lat, CAPE_TOWN.lon, lat, lon);
          if (d < minDist) minDist = d;
        }
      }
    }
  }
  return minDist;
}

// ─────────────────────────────────────────────
// 4. ALERT SYSTEM
// ─────────────────────────────────────────────

/**
 * Check all events; return those within ALERT_RADIUS_KM of Cape Town.
 */
function getEventsNearCapeTown(events) {
  return events
    .map(e => ({ event: e, distKm: distanceFromCapeTown(e) }))
    .filter(({ distKm }) => distKm <= ALERT_RADIUS_KM)
    .sort((a, b) => a.distKm - b.distKm);
}

/**
 * Send a Telegram alert to Isaac via Nuri's bot.
 * Reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from env.
 */
async function sendTelegramAlert(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[disaster-monitor] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping alert');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

/**
 * Run proximity check and fire Telegram alerts if needed.
 */
async function runAlerts() {
  const data = await getCurrentDisasters(['severeStorms', 'floods', 'wildfires', 'volcanoes', 'earthquakes']);
  const nearby = getEventsNearCapeTown(data.events || []);
  if (nearby.length === 0) return;

  const lines = nearby.map(({ event, distKm }) =>
    `• *${event.title}* — ${Math.round(distKm)} km away`
  );
  const msg =
    `🚨 *Disaster Alert — Near Cape Town*\n\n` +
    lines.join('\n') +
    `\n\n_Source: NASA EONET_`;

  await sendTelegramAlert(msg);
  console.log('[disaster-monitor] Alerts sent:', nearby.length);
}

// ─────────────────────────────────────────────
// 5. MORNING BRIEF INTEGRATION
// ─────────────────────────────────────────────

/**
 * Returns a formatted morning brief section about active disasters.
 * Call this from Nuri's morning brief generator (7am cron).
 */
async function getMorningBriefSection() {
  const [africaData, storms, floods] = await Promise.all([
    getAfricaDisasters(7),
    getCurrentDisasters(['severeStorms'], 7),
    getCurrentDisasters(['floods'], 7),
  ]);

  const africaEvents = africaData.events || [];
  const stormTitles  = (storms.events || []).map(e => e.title);
  const floodTitles  = (floods.events || []).map(e => e.title);

  // Near Cape Town check
  const allData = await getCurrentDisasters(
    ['severeStorms', 'floods', 'wildfires', 'volcanoes', 'earthquakes'], 7
  );
  const nearCT = getEventsNearCapeTown(allData.events || []);

  let section = `🌍 *Active disasters near SA:* ${africaEvents.length}\n`;

  if (stormTitles.length) {
    section += `\n⛈️ *Severe Storms (${stormTitles.length}):*\n`;
    section += stormTitles.slice(0, 5).map(t => `  • ${t}`).join('\n');
    if (stormTitles.length > 5) section += `\n  _...and ${stormTitles.length - 5} more_`;
  }

  if (floodTitles.length) {
    section += `\n\n🌊 *Floods (${floodTitles.length}):*\n`;
    section += floodTitles.slice(0, 5).map(t => `  • ${t}`).join('\n');
    if (floodTitles.length > 5) section += `\n  _...and ${floodTitles.length - 5} more_`;
  }

  if (nearCT.length) {
    section += `\n\n🚨 *Within 1000 km of Cape Town:*\n`;
    section += nearCT.map(({ event, distKm }) =>
      `  • ${event.title} (${Math.round(distKm)} km)`
    ).join('\n');
  }

  section += `\n\n_Source: NASA EONET_`;
  return section;
}

// ─────────────────────────────────────────────
// 6. QUICK SUMMARY (for CLI / test run)
// ─────────────────────────────────────────────

async function printSummary() {
  console.log('\n[disaster-monitor] Fetching current open events...\n');

  const [all, africa] = await Promise.all([
    getCurrentDisasters(['severeStorms', 'floods', 'wildfires', 'volcanoes', 'earthquakes'], 7),
    getAfricaDisasters(7),
  ]);

  const events = all.events || [];
  const africaEvents = africa.events || [];
  const nearby = getEventsNearCapeTown(events);

  console.log(`Total open events (global, last 7d): ${events.length}`);
  console.log(`Active events in Africa bbox:        ${africaEvents.length}`);
  console.log(`Events within 1000 km of Cape Town:  ${nearby.length}\n`);

  if (events.length) {
    console.log('── Global events ────────────────────────────');
    events.forEach(e => {
      const dist = distanceFromCapeTown(e);
      const tag  = dist <= ALERT_RADIUS_KM ? ` 🚨 ${Math.round(dist)} km from CT` : '';
      console.log(`  [${e.categories?.[0]?.id ?? 'unknown'}] ${e.title}${tag}`);
    });
  }

  if (africaEvents.length) {
    console.log('\n── Africa events ────────────────────────────');
    africaEvents.forEach(e => console.log(`  • ${e.title}`));
  }

  if (nearby.length) {
    console.log('\n── 🚨 NEAR CAPE TOWN ───────────────────────');
    nearby.forEach(({ event, distKm }) =>
      console.log(`  ${event.title} — ${Math.round(distKm)} km`)
    );
  }

  console.log('\n── Morning Brief Preview ────────────────────');
  const brief = await getMorningBriefSection();
  console.log(brief);
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  getCurrentDisasters,
  getAfricaDisasters,
  getEventsNearCapeTown,
  getMorningBriefSection,
  runAlerts,
  distanceFromCapeTown,
};

// Run directly: node index.js
if (require.main === module) {
  printSummary().catch(console.error);
}
