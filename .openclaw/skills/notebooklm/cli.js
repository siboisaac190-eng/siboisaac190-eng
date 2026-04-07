#!/usr/bin/env node
/**
 * notebooklm — Nuri's NotebookLM CLI
 *
 * Symlink into PATH:
 *   ln -sf ~/.openclaw/skills/notebooklm/cli.js /usr/local/bin/notebooklm
 *   chmod +x ~/.openclaw/skills/notebooklm/cli.js
 *
 * ~/.openclaw/skills/notebooklm/cli.js
 */

'use strict';

const os      = require('os');
const path    = require('path');
const fs      = require('fs');
const { execSync } = require('child_process');

// ─────────────────────────────────────────────────────────────────
// ENV + SESSION
// ─────────────────────────────────────────────────────────────────

// Load .env
const envPath = path.join(os.homedir(), '.openclaw', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const SESSION_PATH = path.join(os.homedir(), '.openclaw', '.nlm-session.json');

function loadSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8')); }
  catch { return { notebookUrl: null, notebookTitle: null, sources: [] }; }
}

function saveSession(session) {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
}

// ─────────────────────────────────────────────────────────────────
// PLAYWRIGHT HELPERS (lazy-loaded)
// ─────────────────────────────────────────────────────────────────

async function getBrowser(headless = true) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless });
  const ctx     = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const cookiePath = process.env.NLM_COOKIES_PATH;
  if (cookiePath) {
    const resolved = cookiePath.replace('~', os.homedir());
    if (fs.existsSync(resolved)) {
      ctx.addCookies(JSON.parse(fs.readFileSync(resolved, 'utf8')));
    }
  }
  return { browser, ctx };
}

async function withPage(fn) {
  const { browser, ctx } = await getBrowser();
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const NLM = 'https://notebooklm.google.com';

async function ensureAuth(page) {
  await page.goto(NLM, { waitUntil: 'networkidle' });
  if (!page.url().includes('accounts.google.com')) return;

  const email = process.env.GOOGLE_EMAIL;
  const pass  = process.env.GOOGLE_PASSWORD;
  if (!email || !pass) throw new Error('Set NLM_COOKIES_PATH or GOOGLE_EMAIL + GOOGLE_PASSWORD');

  await page.fill('input[type="email"]', email);
  await page.click('#identifierNext');
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', pass);
  await page.click('#passwordNext');
  await page.waitForURL(/notebooklm\.google\.com/, { timeout: 30000 });
}

// ─────────────────────────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────────────────────────

const commands = {

  // notebooklm create "Title"
  async create([title]) {
    if (!title) throw new Error('Usage: notebooklm create "<title>"');
    console.log(`Creating notebook: "${title}"...`);

    const notebookUrl = await withPage(async page => {
      await ensureAuth(page);

      const newBtn = page.locator('button:has-text("New notebook"), [aria-label*="New notebook"]').first();
      await newBtn.waitFor({ timeout: 15000 });
      await newBtn.click();
      await page.waitForURL(/notebooklm\.google\.com\/notebooklm/, { timeout: 20000 });

      try {
        const tf = page.locator('[aria-label*="title"], input[placeholder*="title"]').first();
        await tf.waitFor({ timeout: 5000 });
        await tf.click({ clickCount: 3 });
        await tf.fill(title);
        await page.keyboard.press('Enter');
      } catch { /* title field may not be present in all NLM versions */ }

      return page.url();
    });

    const session = loadSession();
    session.notebookTitle = title;
    session.notebookUrl   = notebookUrl;
    session.sources       = [];
    saveSession(session);

    console.log(`✅ Notebook created: ${notebookUrl}`);
  },

  // notebooklm list
  async list() {
    const notebooks = await withPage(async page => {
      await ensureAuth(page);
      await page.goto(NLM, { waitUntil: 'networkidle' });

      const items = await page.locator('[aria-label*="notebook"], .notebook-item, [data-notebook]').all();
      const result = [];
      for (const item of items) {
        const title = await item.textContent().catch(() => '');
        const href  = await item.getAttribute('href').catch(() => '');
        result.push({ title: title.trim(), url: href });
      }
      return result;
    });

    if (!notebooks.length) { console.log('No notebooks found.'); return; }
    notebooks.forEach((n, i) => console.log(`${i + 1}. ${n.title}\n   ${n.url}`));
  },

  // notebooklm status
  async status() {
    const s = loadSession();
    if (!s.notebookUrl) { console.log('No active notebook. Run: notebooklm create "<title>"'); return; }
    console.log(`Active notebook: ${s.notebookTitle}`);
    console.log(`URL: ${s.notebookUrl}`);
    console.log(`Sources: ${s.sources.length}`);
    s.sources.forEach((src, i) => console.log(`  ${i + 1}. ${src}`));
  },

  // notebooklm source add "<url or path>"
  async ['source add']([source]) {
    if (!source) throw new Error('Usage: notebooklm source add "<url or path>"');
    const session = loadSession();
    if (!session.notebookUrl) throw new Error('No active notebook. Run: notebooklm create "<title>"');

    console.log(`Adding source: ${source}`);
    const isFile = !source.startsWith('http') && fs.existsSync(path.resolve(source));

    await withPage(async page => {
      await ensureAuth(page);
      await page.goto(session.notebookUrl, { waitUntil: 'networkidle' });

      const addBtn = page.locator('button:has-text("Add source"), [aria-label*="Add source"]').first();
      await addBtn.waitFor({ timeout: 15000 });
      await addBtn.click();

      if (isFile) {
        const uploadOpt = page.locator('[role="menuitem"]:has-text("Upload"), text=Upload file').first();
        await uploadOpt.waitFor({ timeout: 8000 });
        await uploadOpt.click();
        const [chooser] = await Promise.all([page.waitForEvent('filechooser')]);
        await chooser.setFiles(path.resolve(source));
      } else {
        // Try "Website" option first, fall back to "Link"
        const urlOpt = page.locator('[role="menuitem"]:has-text("Website"), [role="menuitem"]:has-text("URL"), [role="menuitem"]:has-text("Link")').first();
        await urlOpt.waitFor({ timeout: 8000 });
        await urlOpt.click();
        const urlInput = page.locator('input[type="url"], input[placeholder*="URL"], input[placeholder*="http"]').first();
        await urlInput.waitFor({ timeout: 8000 });
        await urlInput.fill(source);
        const insertBtn = page.locator('button:has-text("Insert"), button:has-text("Add"), button:has-text("Submit")').first();
        await insertBtn.click();
      }

      // Wait for source to appear
      await page.waitForTimeout(4000);
    });

    session.sources.push(source);
    saveSession(session);
    console.log(`✅ Source added: ${source}`);
  },

  // notebooklm sources
  async sources() {
    const s = loadSession();
    if (!s.sources.length) { console.log('No sources added yet.'); return; }
    s.sources.forEach((src, i) => console.log(`${i + 1}. ${src}`));
  },

  // notebooklm ask "<question>" [--json]
  async ask([question], flags) {
    if (!question) throw new Error('Usage: notebooklm ask "<question>" [--json]');
    const session = loadSession();
    if (!session.notebookUrl) throw new Error('No active notebook.');
    const asJson = flags.includes('--json');

    console.log(`Asking: "${question}"`);

    const answer = await withPage(async page => {
      await ensureAuth(page);
      await page.goto(session.notebookUrl, { waitUntil: 'networkidle' });

      // Find and use the chat input
      const chatInput = page.locator(
        'textarea[placeholder*="Ask"], textarea[placeholder*="Chat"], [contenteditable][aria-label*="chat"], [contenteditable][aria-label*="message"]'
      ).first();
      await chatInput.waitFor({ timeout: 20000 });
      await chatInput.fill(question);
      await page.keyboard.press('Enter');

      // Wait for response to appear
      await page.waitForTimeout(3000);
      const responseEl = page.locator(
        '[data-message-role="model"], [aria-label*="response"], .assistant-message, .nlm-response'
      ).last();
      await responseEl.waitFor({ timeout: 60000 });
      await page.waitForTimeout(2000); // allow streaming to finish

      return await responseEl.textContent();
    });

    if (asJson) {
      // Ask Claude to structure the answer as JSON
      const { structureAnswer } = require('../notebooklm-client');
      const structured = await structureAnswer(question, answer);
      console.log(JSON.stringify(structured, null, 2));
      return structured;
    } else {
      console.log('\n' + answer.trim());
    }
  },

  // notebooklm generate audio "<title>" [--wait]
  async ['generate audio']([title], flags) {
    const session  = loadSession();
    if (!session.notebookUrl) throw new Error('No active notebook.');
    const wait = flags.includes('--wait');

    console.log(`Generating Audio Overview: "${title}"${wait ? ' (waiting for completion)' : ''}...`);

    const result = await withPage(async page => {
      await ensureAuth(page);
      await page.goto(session.notebookUrl, { waitUntil: 'networkidle' });

      const audioBtn = page.locator(
        'button:has-text("Audio Overview"), button:has-text("Generate audio"), [aria-label*="Audio Overview"]'
      ).first();
      await audioBtn.waitFor({ timeout: 20000 });
      await audioBtn.click();

      try {
        const genBtn = page.locator('button:has-text("Generate"), button:has-text("Start")').first();
        await genBtn.waitFor({ timeout: 5000 });
        await genBtn.click();
      } catch { /* already started */ }

      if (!wait) {
        await page.waitForTimeout(3000);
        return { notebookUrl: page.url(), audioUrl: null, status: 'generating' };
      }

      // Poll for completion
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(15000);
        process.stdout.write('.');
        const audioEl = page.locator('audio, [aria-label*="Play"], a[download]').first();
        if (await audioEl.isVisible().catch(() => false)) {
          const href = await page.locator('a[download]').first().getAttribute('href').catch(() => null);
          return { notebookUrl: page.url(), audioUrl: href || page.url(), status: 'ready' };
        }
      }
      return { notebookUrl: page.url(), audioUrl: null, status: 'timeout' };
    });

    const session2 = loadSession();
    session2.audioUrl = result.audioUrl;
    session2.audioStatus = result.status;
    saveSession(session2);

    if (result.status === 'ready') {
      console.log(`\n✅ Audio ready: ${result.audioUrl}`);
    } else if (result.status === 'generating') {
      console.log(`\n⏳ Generation started. Run "notebooklm status" or visit the notebook to check.`);
      console.log(`   Notebook: ${result.notebookUrl}`);
    } else {
      console.log('\n⚠️  Timed out waiting for audio.');
    }
  },

  // notebooklm download audio <path>
  async ['download audio']([destPath]) {
    const session = loadSession();
    const audioUrl = session.audioUrl;
    if (!audioUrl) throw new Error('No audio URL in session. Run: notebooklm generate audio "<title>" --wait');

    const dest = path.resolve(destPath || './audio-brief.mp3');

    await withPage(async page => {
      await ensureAuth(page);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.goto(audioUrl),
      ]);
      await download.saveAs(dest);
    });

    console.log(`✅ Downloaded → ${dest}`);
  },

  // notebooklm generate quiz [--difficulty easy|medium|hard]
  async ['generate quiz'](args, flags) {
    const difficulty = flags.find(f => /easy|medium|hard/.test(f)) || 'medium';
    await this._generateContent(
      `Generate a ${difficulty} difficulty quiz with 5 questions based on the sources. Format each question as: Q: [question] / A: [answer]`
    );
  },

  // notebooklm generate flashcards
  async ['generate flashcards']() {
    await this._generateContent(
      'Generate 10 flashcards (front/back) from the key concepts in the sources. Format: FRONT: [concept] / BACK: [explanation]'
    );
  },

  // notebooklm generate slide-deck
  async ['generate slide-deck']() {
    await this._generateContent(
      'Generate a 5-slide deck outline based on the sources. For each slide: TITLE: [title] / BULLET POINTS: [3-4 bullets] / SPEAKER NOTES: [notes]'
    );
  },

  async _generateContent(prompt) {
    const session = loadSession();
    if (!session.notebookUrl) throw new Error('No active notebook.');
    return this.ask([prompt], []);
  },

};

// ─────────────────────────────────────────────────────────────────
// CLI DISPATCH
// ─────────────────────────────────────────────────────────────────

async function main() {
  const args  = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith('--'));
  const pos   = args.filter(a => !a.startsWith('--'));

  // Match multi-word commands first (e.g. "source add", "generate audio")
  const twoWord = pos.slice(0, 2).join(' ');
  const oneWord = pos[0];
  const rest    = commands[twoWord] ? pos.slice(2) : pos.slice(1);

  const cmd = commands[twoWord] || commands[oneWord];

  if (!cmd) {
    console.error(`Unknown command: ${pos.join(' ')}`);
    console.error('Available: create, list, status, source add, sources, ask, generate audio, generate quiz, generate flashcards, generate slide-deck, download audio');
    process.exit(1);
  }

  try {
    await cmd.call(commands, rest, flags);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
