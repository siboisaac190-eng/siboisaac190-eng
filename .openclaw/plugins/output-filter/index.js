/**
 * Nuri Output Filter
 * Strips internal tool-use blocks from Claude API responses before
 * anything reaches Telegram (or any other output channel).
 *
 * Usage:
 *   const { extractAssistantText, cleanString } = require('./plugins/output-filter');
 *
 *   // If you have the raw API response object:
 *   await bot.sendMessage(chatId, extractAssistantText(apiResponse));
 *
 *   // If you already assembled a string from stream chunks:
 *   await bot.sendMessage(chatId, cleanString(rawText));
 *
 * ~/.openclaw/plugins/output-filter/index.js
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// 1. EXTRACT FROM CLAUDE API RESPONSE OBJECT
// ─────────────────────────────────────────────────────────────────

/**
 * Given a raw Claude Messages API response object, return only the
 * plain assistant text — no tool_use blocks, no JSON artifacts.
 *
 * @param {Object} response - Full response from anthropic.messages.create()
 * @returns {string}
 */
function extractAssistantText(response) {
  if (!response || !Array.isArray(response.content)) return '';

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────
// 2. CLEAN A RAW STRING
// ─────────────────────────────────────────────────────────────────

/**
 * Strip all tool-call artifacts from a plain string.
 *
 * Handles:
 *  - XML  : <function_calls>...</function_calls> blocks
 *  - JSON : lines that are tool_use / tool_result JSON objects
 *  - Log  : functions.read(...), functions.exec(...), functions.shell(...)
 *  - Log  : [functions.xxx] log-prefix lines
 *  - SSE  : event:/data: lines carrying tool-use payloads
 *  - IDs  : bare toolu_ / call_ identifiers
 *
 * @param {string} text
 * @returns {string}
 */
function cleanString(text) {
  if (typeof text !== 'string') return '';

  // Step 1: remove multiline XML tool-call wrappers first
  let out = text.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');

  // Step 2: process line by line for everything else
  const lines = out.split('\n');
  const kept = [];
  let skipUntilBrace = false; // used to consume multiline JSON tool blocks
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // --- multiline JSON tool_use block tracking ---
    if (skipUntilBrace) {
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) skipUntilBrace = false;
      continue; // drop this line
    }

    // --- single-line JSON tool_use / tool_result ---
    // Matches lines that are clearly a tool-use JSON object
    if (isToolJson(trimmed)) {
      // Check if it's multiline (unclosed braces)
      braceDepth = countBraceDepth(trimmed);
      if (braceDepth > 0) {
        skipUntilBrace = true;
      }
      continue; // drop this line
    }

    // --- functions.xxx(...) inline calls ---
    if (/^functions\.\w+\s*\(/.test(trimmed)) continue;

    // --- [functions.xxx] log prefix lines ---
    if (/^\[functions\.\w+\]/.test(trimmed)) continue;

    // --- SSE event/data lines with tool payloads ---
    if (/^(event|data):\s*\{.*"type"\s*:\s*"(tool_use|tool_result|content_block_start|content_block_stop)"/.test(trimmed)) continue;

    // --- bare tool ID lines (toolu_xxx or call_xxx alone on a line) ---
    if (/^(toolu_|call_)[A-Za-z0-9_-]{8,}$/.test(trimmed)) continue;

    kept.push(line);
  }

  // Collapse 3+ consecutive blank lines to 2
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── helpers ─────────────────────────────────────────────────────

/**
 * Return true if a trimmed line looks like a tool_use / tool_result JSON object.
 */
function isToolJson(trimmed) {
  if (!trimmed.startsWith('{')) return false;
  // Must contain "type":"tool_use" or "type":"tool_result" (with optional spaces)
  return /"type"\s*:\s*"(tool_use|tool_result)"/.test(trimmed);
}

/**
 * Count unclosed braces in a string (positive = more opens than closes).
 */
function countBraceDepth(str) {
  let depth = 0;
  for (const ch of str) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  return depth;
}

// ─────────────────────────────────────────────────────────────────
// 3. STREAMING HELPER
//    Collects a Claude streaming response and returns clean text.
// ─────────────────────────────────────────────────────────────────

/**
 * Consume an Anthropic streaming response and return only clean assistant text.
 *
 * @param {AsyncIterable} stream - result of anthropic.messages.stream(...)
 * @returns {Promise<string>}
 *
 * Example:
 *   const stream = await anthropic.messages.stream({ ... });
 *   const text = await collectStreamText(stream);
 *   await bot.sendMessage(chatId, text);
 */
async function collectStreamText(stream) {
  let text = '';
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta'
    ) {
      text += event.delta.text;
    }
  }
  return cleanString(text);
}

// ─────────────────────────────────────────────────────────────────
// 4. TELEGRAM MIDDLEWARE WRAPPER
// ─────────────────────────────────────────────────────────────────

/**
 * Create a filtered sendMessage helper bound to a Telegram bot instance.
 *
 * Replace:  await bot.sendMessage(CHAT_ID, response);
 * With:     const send = createFilteredSender(bot, CHAT_ID);
 *           await send(response);
 *
 * @param {Object} bot    - node-telegram-bot-api instance
 * @param {string} chatId - Target chat ID
 * @returns {Function}    - async (text, opts?) => void
 */
function createFilteredSender(bot, chatId) {
  return async function sendFiltered(text, opts = {}) {
    const clean = typeof text === 'string'
      ? cleanString(text)
      : extractAssistantText(text);
    if (!clean) return; // never send empty messages
    await bot.sendMessage(chatId, clean, opts);
  };
}

// ─────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────

module.exports = {
  extractAssistantText,
  cleanString,
  collectStreamText,
  createFilteredSender,
};
