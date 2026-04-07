/**
 * Openclaw Gateway — Nuri's core process
 *
 * This is the missing piece. It:
 *   1. Connects to Telegram and receives messages from Isaac
 *   2. Runs the full Claude agent loop (tools actually execute — no more leaked JSON)
 *   3. Sends clean filtered text back to Telegram
 *   4. Writes structured logs to ~/.openclaw/logs/
 *
 * Start:  node ~/.openclaw/gateway.js
 * Dev:    node --watch ~/.openclaw/gateway.js
 * PM2:    pm2 start ~/.openclaw/gateway.js --name openclaw
 *
 * Required env in ~/.openclaw/.env:
 *   ANTHROPIC_API_KEY
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *
 * Optional:
 *   BRAVE_SEARCH_API_KEY
 *   NASA_API_KEY
 *   NLM_COOKIES_PATH
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ─────────────────────────────────────────────────────────────────
// BOOTSTRAP: load .env before anything else
// ─────────────────────────────────────────────────────────────────

const ENV_PATH = path.join(os.homedir(), '.openclaw', '.env');
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────

const LOG_DIR = path.join(os.homedir(), '.openclaw', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const logFile = fs.createWriteStream(
  path.join(LOG_DIR, `gateway-${new Date().toISOString().slice(0, 10)}.log`),
  { flags: 'a' }
);

function log(level, msg, data) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data || {}) });
  logFile.write(line + '\n');
  if (level === 'error') console.error(`[${level}] ${msg}`, data || '');
  else console.log(`[${level}] ${msg}`, data ? JSON.stringify(data).slice(0, 120) : '');
}

// ─────────────────────────────────────────────────────────────────
// VALIDATE ENV
// ─────────────────────────────────────────────────────────────────

const REQUIRED = ['ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const missing  = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  console.error(`   Add them to ${ENV_PATH}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// LOAD PLUGINS
// ─────────────────────────────────────────────────────────────────

const BASE = path.join(os.homedir(), '.openclaw', 'plugins');

const { extractAssistantText, cleanString }  = require(path.join(BASE, 'output-filter'));
const { getMorningBriefSection, runAlerts }  = require(path.join(BASE, 'disaster-monitor'));

// ─────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS + EXECUTORS
// ─────────────────────────────────────────────────────────────────

const TOOL_DEFS = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Use for addresses, phone numbers, business details, news, prices — anything recent.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'web_fetch',
    description: 'Fetch and read the text content of a URL.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'get_disasters',
    description: 'Get current open NASA EONET disaster events near South Africa (storms, floods, wildfires, volcanoes, earthquakes).',
    input_schema: {
      type: 'object',
      properties: {
        categories: { type: 'array', items: { type: 'string' }, description: 'EONET category IDs. Leave empty for all.' },
        days:       { type: 'number', description: 'Days to look back (default 7)' },
      },
    },
  },
  {
    name: 'research_client',
    description: 'Research a business using their website URL. Returns problems, automation opportunities, and proposal angles.',
    input_schema: {
      type: 'object',
      properties: {
        url:  { type: 'string', description: 'Client website URL' },
        name: { type: 'string', description: 'Client name' },
      },
      required: ['url', 'name'],
    },
  },
  {
    name: 'generate_audio',
    description: 'Research a topic and generate a NotebookLM audio brief for a client.',
    input_schema: {
      type: 'object',
      properties: {
        topic:  { type: 'string' },
        client: { type: 'string' },
      },
      required: ['topic', 'client'],
    },
  },
];

async function execWebSearch({ query }) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (key) {
    const params = new URLSearchParams({ q: query, count: 5 });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    });
    if (res.ok) {
      const data = await res.json();
      return (data.web?.results || []).slice(0, 5)
        .map(r => `${r.title}\n${r.url}\n${r.description || ''}`)
        .join('\n\n---\n\n') || 'No results.';
    }
  }
  const params = new URLSearchParams({ q: query, format: 'json', no_html: 1 });
  const res    = await fetch(`https://api.duckduckgo.com/?${params}`);
  const data   = await res.json();
  const parts  = [];
  if (data.AbstractText) parts.push(data.AbstractText);
  if (data.Answer)       parts.push(data.Answer);
  (data.RelatedTopics || []).slice(0, 5).forEach(t => { if (t.Text) parts.push(t.Text); });
  return parts.join('\n\n') || `No results for: ${query}`;
}

async function execWebFetch({ url }) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Nuri/1.0)' } });
  if (!res.ok) return `Fetch failed: ${res.status}`;
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 5000);
}

async function execGetDisasters({ categories = [], days = 7 }) {
  const { getCurrentDisasters, getEventsNearCapeTown } = require(path.join(BASE, 'disaster-monitor'));
  const data   = await getCurrentDisasters(categories, days);
  const events = data.events || [];
  const nearby = getEventsNearCapeTown(events);
  return JSON.stringify({ total: events.length, nearCapeTown: nearby.length, events: events.slice(0, 10) });
}

async function execResearchClient({ url, name }) {
  const { researchClient } = require(path.join(BASE, 'notebooklm-client'));
  const result = await researchClient(url, name);
  return JSON.stringify(result, null, 2);
}

async function execGenerateAudio({ topic, client }) {
  const { runAudioFactory } = require(path.join(BASE, 'audio-factory'));
  const result = await runAudioFactory({ topic, client, skipNLM: false });
  return `Audio brief generated.\nNotebook: ${result.notebookUrl}\nAudio: ${result.audioUrl}`;
}

const EXECUTORS = {
  web_search:      execWebSearch,
  web_fetch:       execWebFetch,
  get_disasters:   execGetDisasters,
  research_client: execResearchClient,
  generate_audio:  execGenerateAudio,
};

// ─────────────────────────────────────────────────────────────────
// AGENT LOOP
// ─────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are Nuri, Isaac's autonomous AI Business OS in Cape Town, South Africa.
You help Isaac run his AI automation freelancing business — finding clients, writing proposals,
tracking revenue, and delivering AI solutions.

You have tools. ALWAYS use them when needed — never say "I can't check" when you have web_search.
Respond concisely. Use plain text for Telegram (no markdown except *bold* and _italic_).
Current date: ${new Date().toDateString()}.`;

async function runAgentLoop(userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < 15; i++) {
    const response = await anthropic.messages.create({
      model:        'claude-opus-4-6',
      max_tokens:   2048,
      thinking:     { type: 'adaptive' },
      system:       SYSTEM,
      tools:        TOOL_DEFS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      return extractAssistantText(response);
    }

    if (response.stop_reason === 'tool_use') {
      const results = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const exec = EXECUTORS[block.name];
        let content;
        try {
          log('info', `tool:${block.name}`, block.input);
          content = exec ? await exec(block.input) : `Unknown tool: ${block.name}`;
        } catch (e) {
          content = `Tool error: ${e.message}`;
          log('error', `tool:${block.name} failed`, { error: e.message });
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: String(content) });
      }
      messages.push({ role: 'user', content: results });
    }
  }
  return '(max iterations reached)';
}

// ─────────────────────────────────────────────────────────────────
// CONVERSATION MEMORY (simple in-memory per chat_id)
// ─────────────────────────────────────────────────────────────────

const sessions = new Map(); // chatId → MessageParam[]

function getHistory(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, []);
  return sessions.get(chatId);
}

function appendHistory(chatId, userText, assistantText) {
  const h = getHistory(chatId);
  h.push({ role: 'user',      content: userText });
  h.push({ role: 'assistant', content: assistantText });
  // Keep last 20 turns (40 messages) to avoid context bloat
  if (h.length > 40) h.splice(0, h.length - 40);
}

// ─────────────────────────────────────────────────────────────────
// TELEGRAM BOT
// ─────────────────────────────────────────────────────────────────

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ALLOWED_CHAT = process.env.TELEGRAM_CHAT_ID;

async function reply(chatId, text) {
  const clean = cleanString(text);
  if (!clean) return;
  // Telegram max message length is 4096 chars — split if needed
  const chunks = [];
  for (let i = 0; i < clean.length; i += 4000) chunks.push(clean.slice(i, i + 4000));
  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk).catch(e =>
      log('error', 'sendMessage failed', { error: e.message })
    );
  }
}

bot.on('message', async msg => {
  const chatId = String(msg.chat.id);
  const text   = msg.text?.trim();

  if (!text || chatId !== String(ALLOWED_CHAT)) return;

  log('info', 'message', { chatId, text: text.slice(0, 100) });

  // Special commands
  if (text === '/start' || text === '/help') {
    await reply(chatId, 'Nuri is online. Ask me anything — I can search the web, research clients, check for disasters near SA, and more.');
    return;
  }

  if (text === '/clear') {
    sessions.delete(chatId);
    await reply(chatId, 'Conversation cleared.');
    return;
  }

  if (text === '/status') {
    const turns = Math.floor((getHistory(chatId).length) / 2);
    await reply(chatId, `Gateway: online\nModel: claude-opus-4-6\nConversation turns: ${turns}\nTools: ${TOOL_DEFS.map(t => t.name).join(', ')}`);
    return;
  }

  // Typing indicator
  bot.sendChatAction(chatId, 'typing').catch(() => {});

  try {
    const history  = getHistory(chatId);
    const answer   = await runAgentLoop(text, history);
    appendHistory(chatId, text, answer);
    await reply(chatId, answer);
    log('info', 'replied', { chars: answer.length });
  } catch (err) {
    log('error', 'agent loop failed', { error: err.message });
    await reply(chatId, `Sorry, something went wrong: ${err.message}`);
  }
});

bot.on('polling_error', err => log('error', 'polling_error', { error: err.message }));

// ─────────────────────────────────────────────────────────────────
// MORNING BRIEF (7am daily)
// ─────────────────────────────────────────────────────────────────

function scheduleMorningBrief() {
  const now   = new Date();
  const next7 = new Date(now);
  next7.setHours(7, 0, 0, 0);
  if (next7 <= now) next7.setDate(next7.getDate() + 1);

  const msUntil = next7 - now;
  log('info', `morning brief scheduled in ${Math.round(msUntil / 60000)} min`);

  setTimeout(async () => {
    try {
      const disasters = await getMorningBriefSection();
      const brief = `🌅 *Good morning, Isaac!*\n\n${disasters}\n\n_Nuri — ${new Date().toDateString()}_`;
      await bot.sendMessage(ALLOWED_CHAT, cleanString(brief));
      log('info', 'morning brief sent');
    } catch (e) {
      log('error', 'morning brief failed', { error: e.message });
    }
    scheduleMorningBrief(); // reschedule for tomorrow
  }, msUntil);
}

// ─────────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────────

log('info', 'openclaw gateway starting', {
  model:   'claude-opus-4-6',
  tools:   TOOL_DEFS.map(t => t.name),
  chatId:  ALLOWED_CHAT,
});

scheduleMorningBrief();
runAlerts().catch(e => log('error', 'startup alert check failed', { error: e.message }));

console.log('✅ Openclaw gateway running. Waiting for messages...');
