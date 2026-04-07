/**
 * Nuri Audio Producer — Research Module
 * Uses Claude claude-opus-4-6 with adaptive thinking to gather 5-7 authoritative
 * sources on a topic and write a structured sources.md for NotebookLM.
 *
 * Requires: ANTHROPIC_API_KEY in env
 */

'use strict';

const fs   = require('fs').promises;
const path = require('path');

// ─────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS  (web_search + web_fetch)
// ─────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web for authoritative sources on a topic. Use for finding research papers, expert articles, statistics, and news.',
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
    description: 'Fetch and read the content of a URL to extract source material.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────
// TOOL EXECUTORS
// ─────────────────────────────────────────────────────────────────

async function execWebSearch({ query }) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    const params = new URLSearchParams({ q: query, count: 7 });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
    });
    if (res.ok) {
      const data = await res.json();
      return (data.web?.results || [])
        .slice(0, 7)
        .map(r => `TITLE: ${r.title}\nURL: ${r.url}\nSNIPPET: ${r.description || ''}`)
        .join('\n\n---\n\n');
    }
  }
  // DuckDuckGo fallback
  const params = new URLSearchParams({ q: query, format: 'json', no_html: 1 });
  const res    = await fetch(`https://api.duckduckgo.com/?${params}`);
  const data   = await res.json();
  const parts  = [];
  if (data.AbstractText) parts.push(data.AbstractText);
  (data.RelatedTopics || []).slice(0, 6).forEach(t => { if (t.Text) parts.push(t.Text); });
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
    .slice(0, 6000);
}

const EXECUTORS = { web_search: execWebSearch, web_fetch: execWebFetch };

// ─────────────────────────────────────────────────────────────────
// RESEARCH AGENT LOOP
// ─────────────────────────────────────────────────────────────────

const SYSTEM = `You are Nuri's audio production researcher.

Your task: research a topic thoroughly and produce a structured markdown document
containing 5-7 authoritative sources suitable for NotebookLM's Audio Overview feature.

PROCESS:
1. Run 2-3 targeted web searches to find strong sources
2. Fetch and skim the most promising URLs
3. Select the 5-7 best sources (primary sources, expert commentary, data)
4. Write the final sources.md document

OUTPUT FORMAT (write this exact structure):
# [Topic] — Source Compilation for NotebookLM

## Overview
[2-3 sentence summary of what these sources cover and why they were chosen]

## Sources

### Source 1: [Title]
- **URL:** [url]
- **Type:** [Research Paper / News Article / Expert Analysis / Official Report / etc.]
- **Why it matters:** [1-2 sentences]
- **Key points:**
  - [bullet]
  - [bullet]
  - [bullet]

[repeat for each source]

## Key Themes
- [theme 1]
- [theme 2]
- [theme 3]

## Suggested Audio Angle
[One paragraph suggesting how NotebookLM should frame the audio overview]`;

/**
 * Research a topic and write sources.md to the output directory.
 *
 * @param {Object} anthropic  - Anthropic SDK client
 * @param {string} topic      - Research topic
 * @param {string} outputDir  - Directory to write sources.md
 * @returns {Promise<string>} - Path to the written sources.md
 */
async function researchTopic(anthropic, topic, outputDir) {
  console.log(`[research] Starting research: "${topic}"`);

  await fs.mkdir(outputDir, { recursive: true });

  const messages = [
    {
      role: 'user',
      content: `Research this topic and produce the sources.md document: ${topic}`,
    },
  ];

  let iteration = 0;
  const MAX = 12;

  while (iteration < MAX) {
    iteration++;

    const response = await anthropic.messages.create({
      model:        'claude-opus-4-6',
      max_tokens:   8192,
      thinking:     { type: 'adaptive' },
      output_config: { effort: 'high' },
      system:       SYSTEM,
      tools:        TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract the final markdown text
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();

      const outPath = path.join(outputDir, 'sources.md');
      await fs.writeFile(outPath, text, 'utf8');
      console.log(`[research] Sources written → ${outPath}`);
      return outPath;
    }

    if (response.stop_reason === 'tool_use') {
      const results = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const exec = EXECUTORS[block.name];
        let content;
        try {
          console.log(`[research] Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 80));
          content = exec ? await exec(block.input) : `Unknown tool: ${block.name}`;
        } catch (e) {
          content = `Tool error: ${e.message}`;
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content });
      }
      messages.push({ role: 'user', content: results });
    }
  }

  throw new Error('[research] Max iterations reached without completing sources.md');
}

module.exports = { researchTopic };
