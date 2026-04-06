/**
 * Nuri Agent Loop
 * Closes the tool-use cycle that was breaking Nuri's responses.
 *
 * The bug: Claude returns a tool_use block → Nuri printed it raw → stopped.
 * It never executed the tool, never sent tool_result back → no final answer.
 *
 * This module runs the full agentic loop:
 *   user message → Claude → [tool call → execute → tool_result → Claude] × N → final text
 *
 * Usage:
 *   const { runAgentLoop } = require('./plugins/agent-loop');
 *   const answer = await runAgentLoop(anthropic, 'Give me the address for Hudsons Green Point');
 *   await bot.sendMessage(chatId, answer);
 *
 * ~/.openclaw/plugins/agent-loop/index.js
 */

'use strict';

const { extractAssistantText, cleanString } = require('../output-filter');

const MAX_ITERATIONS = 10; // safety cap — prevent infinite loops

// ─────────────────────────────────────────────────────────────────
// TOOL REGISTRY
// Maps tool names Claude may call → local executor functions.
// Add your own tools here.
// ─────────────────────────────────────────────────────────────────

const TOOLS = {
  /**
   * Web search via DuckDuckGo Instant Answer API (no key needed).
   * For richer results wire in a SerpAPI / Brave Search key via env.
   */
  web_search:        execWebSearch,
  'functions.web_search': execWebSearch,

  /**
   * Fetch a URL and return its text content (stripped of HTML tags).
   */
  web_fetch:         execWebFetch,
  'functions.web_fetch': execWebFetch,

  /**
   * Read a local file.
   */
  read_file:         execReadFile,
  'functions.read':  execReadFile,

  /**
   * Run a shell command (careful — only allow safe commands in production).
   */
  shell:             execShell,
  'functions.shell': execShell,
  'functions.exec':  execShell,
};

// ─────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS (sent to Claude so it knows what's available)
// ─────────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Use for addresses, phone numbers, business info, news, prices, anything that may have changed recently.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch and read the content of a URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a local file by path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'shell',
    description: 'Run a shell command and return stdout.',
    input_schema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['cmd'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────
// MAIN AGENT LOOP
// ─────────────────────────────────────────────────────────────────

/**
 * Run the full agentic loop until Claude produces a final text answer
 * with no pending tool calls.
 *
 * @param {Object}   anthropic        - Anthropic SDK client instance
 * @param {string}   userMessage      - The user's question / request
 * @param {Object}   [opts]
 * @param {string}   [opts.model]     - Claude model (default: claude-sonnet-4-6)
 * @param {string}   [opts.system]    - System prompt override
 * @param {Array}    [opts.tools]     - Tool definitions override
 * @param {number}   [opts.maxTokens] - Max tokens per call (default: 1024)
 * @returns {Promise<string>}          - Clean final assistant text
 */
async function runAgentLoop(anthropic, userMessage, opts = {}) {
  const model     = opts.model     || 'claude-sonnet-4-6';
  const maxTokens = opts.maxTokens || 1024;
  const tools     = opts.tools     || TOOL_DEFINITIONS;
  const system    = opts.system    || 'You are Nuri, an autonomous AI Business OS. Answer clearly and concisely. Always complete tool calls to get real information before answering.';

  const messages = [
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools,
      messages,
    });

    // Add Claude's response to the conversation history
    messages.push({ role: 'assistant', content: response.content });

    // If Claude is done (no tool calls) — return the clean text
    if (response.stop_reason === 'end_turn') {
      return extractAssistantText(response);
    }

    // If Claude wants to use tools — execute them all, collect results
    if (response.stop_reason === 'tool_use') {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const executor = TOOLS[block.name];
        let resultContent;

        if (!executor) {
          resultContent = `Error: unknown tool "${block.name}"`;
          console.warn(`[agent-loop] No executor registered for tool: ${block.name}`);
        } else {
          try {
            console.log(`[agent-loop] Running tool: ${block.name}`, block.input);
            resultContent = await executor(block.input);
          } catch (err) {
            resultContent = `Tool error: ${err.message}`;
            console.error(`[agent-loop] Tool "${block.name}" threw:`, err.message);
          }
        }

        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     String(resultContent),
        });
      }

      // Send tool results back to Claude
      messages.push({ role: 'user', content: toolResults });
      continue; // next iteration → Claude sees results and responds
    }

    // Unexpected stop reason — return whatever text we have
    console.warn('[agent-loop] Unexpected stop_reason:', response.stop_reason);
    return extractAssistantText(response) || '(no response)';
  }

  return '(max iterations reached — no final answer)';
}

// ─────────────────────────────────────────────────────────────────
// TOOL EXECUTORS
// ─────────────────────────────────────────────────────────────────

/**
 * Web search.
 * Primary: Brave Search API (set BRAVE_SEARCH_API_KEY in .env)
 * Fallback: DuckDuckGo Instant Answer (no key, limited results)
 */
async function execWebSearch({ query }) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  if (braveKey) {
    const params = new URLSearchParams({ q: query, count: 5 });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey },
    });
    if (res.ok) {
      const data = await res.json();
      const results = (data.web?.results || []).slice(0, 5);
      if (results.length) {
        return results.map(r => `${r.title}\n${r.url}\n${r.description || ''}`).join('\n\n');
      }
    }
  }

  // DuckDuckGo fallback
  const params = new URLSearchParams({ q: query, format: 'json', no_html: 1 });
  const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
    headers: { 'Accept': 'application/json' },
  });
  const data = await res.json();

  const parts = [];
  if (data.AbstractText) parts.push(data.AbstractText);
  if (data.Answer)       parts.push(data.Answer);
  (data.RelatedTopics || []).slice(0, 5).forEach(t => {
    if (t.Text) parts.push(t.Text);
  });

  return parts.length ? parts.join('\n\n') : `No results found for: ${query}`;
}

/**
 * Fetch a URL and return stripped text content.
 */
async function execWebFetch({ url }) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Nuri/1.0)' },
  });
  if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`;
  const html = await res.text();
  // Strip HTML tags and collapse whitespace
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 4000); // truncate to avoid massive tokens
}

/**
 * Read a local file.
 */
async function execReadFile({ path }) {
  const fs = require('fs').promises;
  return await fs.readFile(path, 'utf8');
}

/**
 * Run a shell command.
 */
async function execShell({ cmd }) {
  const { execSync } = require('child_process');
  return execSync(cmd, { encoding: 'utf8', timeout: 10000 });
}

// ─────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────

module.exports = {
  runAgentLoop,
  TOOL_DEFINITIONS,
  TOOLS,
};
