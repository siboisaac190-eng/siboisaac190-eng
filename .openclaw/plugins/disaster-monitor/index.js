/**
 * NASA EONET Disaster Monitor — Nuri Plugin
 * EONET: no API key required.
 * Asteroids (NeoWs): set NASA_API_KEY in your .env
 * ~/.openclaw/plugins/disaster-monitor/index.js
 */

'use strict';

const EONET_BASE    = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const NEO_BASE      = 'https://api.nasa.gov/neo/rest/v1/feed';

// Cape Town coordinates
const CAPE_TOWN      = { lat: -33.9249, lon: 18.4241 };
const ALERT_RADIUS_KM = 1000;

// Africa bounding box: lon -18 to 52, lat -36 to 38
// EONET bbox format: west,north,east,south
const AFRICA_BBOX = '-18,38,52,-36';

// ─────────────────────────────────────────────
// 1. FETCH CURRENT DISASTERS (EONET — no key)
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
// 3. ASTEROIDS — Near Earth Objects (NeoWs)
//    Requires NASA_API_KEY env var
// ─────────────────────────────────────────────

/**
 * Fetch Near Earth Objects for a date range (max 7 days per request).
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate   - YYYY-MM-DD (max 7 days after startDate)
 * @returns {Object} NeoWs feed response
 */
async function getNearEarthObjects(startDate, endDate) {
  const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, api_key: apiKey });
  const res = await fetch(`${NEO_BASE}?${params}`);
  if (!res.ok) throw new Error(`NeoWs fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Get potentially hazardous asteroids for today + next 3 days.
 * Returns a flat array of hazardous NEO objects with their closest approach data.
 */
async function getHazardousAsteroids() {
  const today = new Date();
  const end   = new Date(today);
  end.setDate(end.getDate() + 3);

  const fmt  = d => d.toISOString().slice(0, 10);
  const data = await getNearEarthObjects(fmt(today), fmt(end));

  const hazardous = [];
  for (const [date, neos] of Object.entries(data.near_earth_objects || {})) {
    for (const neo of neos) {
      if (!neo.is_potentially_hazardous_asteroid) continue;
      const approach = neo.close_approach_data?.[0];
      hazardous.push({
        id:           neo.id,
        name:         neo.name,
        date,
        diameterKm: {
          min: neo.estimated_diameter?.kilometers?.estimated_diameter_min?.toFixed(3),
          max: neo.estimated_diameter?.kilometers?.estimated_diameter_max?.toFixed(3),
        },
        missDistanceKm: approach
          ? Number(approach.miss_distance?.kilometers).toLocaleString()
          : 'unknown',
        velocityKmH: approach
          ? Number(approach.relative_velocity?.kilometers_per_hour).toLocaleString()
          : 'unknown',
        closeApproachDate: approach?.close_approach_date_full || date,
      });
    }
  }

  return hazardous.sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────────────────────────────────────
// 4. DISTANCE HELPER (Haversine)
// ─────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Return the closest geometry point distance (km) from Cape Town for an event.
 */
function distanceFromCapeTown(event) {
  if (!event.geometry || event.geometry.length === 0) return Infinity;

  let minDist = Infinity;
  for (const geom of event.geometry) {
    const coords = geom.coordinates;
    if (!coords) continue;

    if (geom.type === 'Point') {
      const d = haversineKm(CAPE_TOWN.lat, CAPE_TOWN.lon, coords[1], coords[0]);
      if (d < minDist) minDist = d;
    }
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
// 5. ALERT SYSTEM
// ─────────────────────────────────────────────

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
  const data   = await getCurrentDisasters(['severeStorms', 'floods', 'wildfires', 'volcanoes', 'earthquakes']);
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
// 6. MORNING BRIEF INTEGRATION
// ─────────────────────────────────────────────

/**
 * Returns a formatted morning brief section.
 * Call this from Nuri's morning brief generator (7am cron).
 */
async function getMorningBriefSection() {
  const [africaData, storms, floods, allData] = await Promise.all([
    getAfricaDisasters(7),
    getCurrentDisasters(['severeStorms'], 7),
    getCurrentDisasters(['floods'], 7),
    getCurrentDisasters(['severeStorms', 'floods', 'wildfires', 'volcanoes', 'earthquakes'], 7),
  ]);

  const africaEvents = africaData.events || [];
  const stormTitles  = (storms.events || []).map(e => e.title);
  const floodTitles  = (floods.events || []).map(e => e.title);
  const nearCT       = getEventsNearCapeTown(allData.events || []);

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

  // Asteroids (only if NASA_API_KEY is configured)
  if (process.env.NASA_API_KEY) {
    try {
      const hazardous = await getHazardousAsteroids();
      if (hazardous.length) {
        section += `\n\n☄️ *Hazardous Asteroids (next 3 days): ${hazardous.length}*\n`;
        section += hazardous.slice(0, 3).map(a =>
          `  • ${a.name} — miss dist: ${a.missDistanceKm} km (${a.closeApproachDate})`
        ).join('\n');
        if (hazardous.length > 3) section += `\n  _...and ${hazardous.length - 3} more_`;
      }
    } catch (e) {
      console.warn('[disaster-monitor] Asteroid fetch failed:', e.message);
    }
  }

  section += `\n\n_Source: NASA EONET & NeoWs_`;
  return section;
}

// ─────────────────────────────────────────────
// 7. QUICK SUMMARY (standalone test)
// ─────────────────────────────────────────────

async function printSummary() {
  console.log('\n[disaster-monitor] Fetching current open events...\n');

  const [all, africa] = await Promise.all([
    getCurrentDisasters(['severeStorms', 'floods', 'wildfires', 'volcanoes', 'earthquakes'], 7),
    getAfricaDisasters(7),
  ]);

  const events       = all.events || [];
  const africaEvents = africa.events || [];
  const nearby       = getEventsNearCapeTown(events);

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

  // Asteroids
  if (process.env.NASA_API_KEY) {
    console.log('\n── Hazardous Asteroids (next 3 days) ────────');
    try {
      const hazardous = await getHazardousAsteroids();
      if (!hazardous.length) {
        console.log('  None detected.');
      } else {
        hazardous.forEach(a => {
          console.log(`  ☄️  ${a.name}`);
          console.log(`      Diameter: ${a.diameterKm.min}–${a.diameterKm.max} km`);
          console.log(`      Miss dist: ${a.missDistanceKm} km`);
          console.log(`      Speed:     ${a.velocityKmH} km/h`);
          console.log(`      Approach:  ${a.closeApproachDate}`);
        });
      }
    } catch (e) {
      console.warn('  Asteroid fetch failed:', e.message);
    }
  } else {
    console.log('\n── Asteroids ─────────────────────────────────');
    console.log('  Set NASA_API_KEY env var to enable asteroid monitoring.');
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
  getNearEarthObjects,
  getHazardousAsteroids,
  getEventsNearCapeTown,
  getMorningBriefSection,
  runAlerts,
  distanceFromCapeTown,
};

// Run directly: node index.js
if (require.main === module) {
  printSummary().catch(console.error);
}
