/**
 * Nuri Audio Factory — NotebookLM Automation
 *
 * NotebookLM has no official API. This module automates it via Playwright
 * browser automation using a logged-in Google account.
 *
 * Prerequisites:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Required env:
 *   GOOGLE_EMAIL     — Google account email
 *   GOOGLE_PASSWORD  — Google account password  (or use cookie auth below)
 *   NLM_COOKIES_PATH — Path to exported cookies JSON (recommended over password)
 *
 * Cookie export (recommended — avoids 2FA issues):
 *   1. Log into notebooklm.google.com in Chrome
 *   2. Install "Cookie-Editor" extension → Export All → save to ~/.openclaw/nlm-cookies.json
 *   3. Set NLM_COOKIES_PATH=~/.openclaw/nlm-cookies.json
 */

'use strict';

const path = require('path');
const fs   = require('fs').promises;

const NLM_BASE = 'https://notebooklm.google.com';

// ─────────────────────────────────────────────────────────────────
// BROWSER SESSION
// ─────────────────────────────────────────────────────────────────

async function launchBrowser(headless = true) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless });
  const ctx     = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport:  { width: 1280, height: 800 },
  });

  // Load saved cookies if available (preferred auth method)
  const cookiePath = process.env.NLM_COOKIES_PATH;
  if (cookiePath) {
    try {
      const resolved = cookiePath.replace('~', require('os').homedir());
      const raw      = await fs.readFile(resolved, 'utf8');
      const cookies  = JSON.parse(raw);
      await ctx.addCookies(cookies);
      console.log('[notebooklm] Loaded cookies from', resolved);
    } catch (e) {
      console.warn('[notebooklm] Could not load cookies:', e.message);
    }
  }

  return { browser, ctx };
}

async function ensureLoggedIn(page) {
  await page.goto(NLM_BASE, { waitUntil: 'networkidle' });

  // Check if already authenticated
  const url = page.url();
  if (url.includes('notebooklm.google.com') && !url.includes('accounts.google.com')) {
    console.log('[notebooklm] Already authenticated via cookies');
    return;
  }

  // Fall back to password auth
  const email    = process.env.GOOGLE_EMAIL;
  const password = process.env.GOOGLE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Not authenticated. Set NLM_COOKIES_PATH (recommended) or GOOGLE_EMAIL + GOOGLE_PASSWORD'
    );
  }

  console.log('[notebooklm] Logging in with email/password...');
  await page.fill('input[type="email"]', email);
  await page.click('#identifierNext');
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', password);
  await page.click('#passwordNext');
  await page.waitForURL(/notebooklm\.google\.com/, { timeout: 30000 });
  console.log('[notebooklm] Login successful');
}

// ─────────────────────────────────────────────────────────────────
// NOTEBOOK OPERATIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Create a new notebook and return its URL.
 */
async function createNotebook(page, title) {
  await page.goto(NLM_BASE, { waitUntil: 'networkidle' });

  // Click "New notebook"
  const newBtn = page.locator('button:has-text("New notebook"), [aria-label*="New notebook"]').first();
  await newBtn.waitFor({ timeout: 15000 });
  await newBtn.click();

  // Wait for the notebook editor to load
  await page.waitForURL(/notebooklm\.google\.com\/notebooklm/, { timeout: 20000 });
  const notebookUrl = page.url();
  console.log(`[notebooklm] Created notebook → ${notebookUrl}`);

  // Set notebook title if field is available
  try {
    const titleField = page.locator('[aria-label*="title"], input[placeholder*="title"]').first();
    await titleField.waitFor({ timeout: 5000 });
    await titleField.click({ clickCount: 3 });
    await titleField.fill(title);
    await page.keyboard.press('Enter');
    console.log(`[notebooklm] Title set: ${title}`);
  } catch {
    console.warn('[notebooklm] Could not set title — continuing');
  }

  return notebookUrl;
}

/**
 * Upload a sources.md file as a source into the open notebook.
 */
async function addSourceFile(page, sourcesPath) {
  // Click "Add source"
  const addBtn = page.locator('button:has-text("Add source"), [aria-label*="Add source"]').first();
  await addBtn.waitFor({ timeout: 15000 });
  await addBtn.click();

  // Choose "Upload file"
  const uploadOption = page.locator('text=Upload file, [role="menuitem"]:has-text("Upload")').first();
  await uploadOption.waitFor({ timeout: 8000 });
  await uploadOption.click();

  // Intercept the file chooser dialog
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    // trigger click if needed
  ]);
  await fileChooser.setFiles(sourcesPath);

  // Wait for upload confirmation
  await page.waitForSelector('[aria-label*="source"], .source-item, [data-source]', {
    timeout: 30000,
  });
  console.log(`[notebooklm] Source uploaded: ${path.basename(sourcesPath)}`);
}

/**
 * Add a text block (paste markdown directly) as a source.
 * Fallback when file upload dialog is not available.
 */
async function addSourceText(page, text, title = 'Research Sources') {
  const addBtn = page.locator('button:has-text("Add source"), [aria-label*="Add source"]').first();
  await addBtn.waitFor({ timeout: 15000 });
  await addBtn.click();

  const pasteOption = page.locator('text=Copied text, [role="menuitem"]:has-text("text")').first();
  await pasteOption.waitFor({ timeout: 8000 });
  await pasteOption.click();

  const textArea = page.locator('textarea, [contenteditable="true"]').first();
  await textArea.waitFor({ timeout: 8000 });
  await textArea.fill(text);

  const insertBtn = page.locator('button:has-text("Insert"), button:has-text("Add")').first();
  await insertBtn.waitFor({ timeout: 8000 });
  await insertBtn.click();

  await page.waitForTimeout(3000);
  console.log(`[notebooklm] Source text inserted (${text.length} chars)`);
}

/**
 * Click "Generate" to trigger the Audio Overview.
 * Returns the notebook URL (audio is generated async by NotebookLM).
 */
async function generateAudioOverview(page) {
  // The Audio Overview button may be in different locations depending on NLM version
  const audioBtn = page.locator(
    'button:has-text("Audio Overview"), button:has-text("Generate audio"), [aria-label*="Audio Overview"]'
  ).first();

  await audioBtn.waitFor({ timeout: 20000 });
  await audioBtn.click();
  console.log('[notebooklm] Audio Overview generation triggered');

  // Some versions show a "Generate" confirmation button
  try {
    const genBtn = page.locator('button:has-text("Generate"), button:has-text("Start")').first();
    await genBtn.waitFor({ timeout: 5000 });
    await genBtn.click();
    console.log('[notebooklm] Generation confirmed');
  } catch {
    // Already started — no confirmation needed
  }

  // Wait for NotebookLM to acknowledge (audio generation is async on their servers)
  await page.waitForTimeout(5000);

  return page.url();
}

/**
 * Poll until the audio is ready and return its download URL.
 * NotebookLM typically takes 2-5 minutes for a 10-minute audio.
 * @param {number} timeoutMs - Max wait time in ms (default 10 min)
 */
async function waitForAudio(page, timeoutMs = 10 * 60 * 1000) {
  console.log('[notebooklm] Waiting for audio generation (may take 2-5 minutes)...');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await page.waitForTimeout(15000); // poll every 15s

    // Look for audio player or download link
    const audioEl = page.locator('audio, [aria-label*="Play"], button:has-text("Download"), a[download]').first();
    const visible  = await audioEl.isVisible().catch(() => false);

    if (visible) {
      console.log('[notebooklm] Audio is ready!');

      // Try to get download URL
      const downloadLink = page.locator('a[download], button:has-text("Download")').first();
      if (await downloadLink.isVisible().catch(() => false)) {
        const href = await downloadLink.getAttribute('href').catch(() => null);
        if (href) return href;
      }

      return page.url(); // return notebook URL if no direct download link
    }

    process.stdout.write('.');
  }

  throw new Error('[notebooklm] Timed out waiting for audio');
}

// ─────────────────────────────────────────────────────────────────
// MAIN EXPORT: full pipeline
// ─────────────────────────────────────────────────────────────────

/**
 * Full NotebookLM pipeline:
 *   create notebook → add source → trigger audio → wait → return url
 *
 * @param {Object} opts
 * @param {string} opts.title      - Notebook title
 * @param {string} opts.sourcesPath - Path to sources.md file
 * @param {boolean} [opts.headless] - Run headless (default true)
 * @returns {Promise<{notebookUrl, audioUrl}>}
 */
async function runNotebookLMPipeline({ title, sourcesPath, headless = true }) {
  let browser;
  try {
    const { browser: b, ctx } = await launchBrowser(headless);
    browser = b;
    const page = await ctx.newPage();

    await ensureLoggedIn(page);

    const notebookUrl = await createNotebook(page, title);

    // Try file upload, fall back to text paste
    try {
      await addSourceFile(page, sourcesPath);
    } catch {
      console.warn('[notebooklm] File upload failed, falling back to text paste');
      const text = await fs.readFile(sourcesPath, 'utf8');
      await addSourceText(page, text, title);
    }

    const finalUrl  = await generateAudioOverview(page);
    const audioUrl  = await waitForAudio(page);

    return { notebookUrl: finalUrl, audioUrl };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { runNotebookLMPipeline };
