/**
 * Nuri NotebookLM Client — researchClient & structureAnswer
 *
 * Usage:
 *   const { researchClient } = require('./plugins/notebooklm-client');
 *   const insights = await researchClient('https://masamara.co.za', 'Masa Mara');
 *
 * ~/.openclaw/plugins/notebooklm-client/index.js
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');

// Path to the notebooklm CLI
const NLM_CLI = path.join(os.homedir(), '.openclaw', 'skills', 'notebooklm', 'cli.js');

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function nlm(cmd) {
  // Run a notebooklm CLI command and return stdout as string
  return execSync(`node "${NLM_CLI}" ${cmd}`, {
    encoding: 'utf8',
    timeout:  5 * 60 * 1000, // 5 min max per command
    env: process.env,
  }).trim();
}

function nlmJson(cmd) {
  const raw = nlm(cmd);
  // Extract the JSON block (last {...} block in output)
  const match = raw.match(/\{[\s\S]*\}(?=[^{}]*$)/);
  if (match) return JSON.parse(match[0]);
  return { raw };
}

function getAnthropicClient() {
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ─────────────────────────────────────────────────────────────────
// STRUCTURE ANSWER
// Called by CLI's "ask --json" to convert plain text → structured JSON
// ─────────────────────────────────────────────────────────────────

/**
 * Use Claude to turn a NotebookLM plain-text answer into structured JSON.
 *
 * @param {string} question  - Original question asked
 * @param {string} answer    - Plain text answer from NotebookLM
 * @returns {Promise<Object>}
 */
async function structureAnswer(question, answer) {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model:      'claude-opus-4-6',
    max_tokens: 2048,
    thinking:   { type: 'adaptive' },
    system:     'You convert research answers into clean structured JSON. Return ONLY valid JSON, no markdown fences.',
    messages: [{
      role:    'user',
      content: `Question: ${question}\n\nAnswer:\n${answer}\n\nConvert this answer into structured JSON with appropriate keys. Be specific and actionable.`,
    }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    // If Claude wrapped it in fences, strip them
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  }
}

// ─────────────────────────────────────────────────────────────────
// RESEARCH CLIENT
// Full pipeline: create notebook → add sources → ask questions → return insights
// ─────────────────────────────────────────────────────────────────

/**
 * Research a client using NotebookLM + Claude.
 *
 * Steps:
 *   1. Create a NotebookLM notebook for the client
 *   2. Add their website as a source
 *   3. Ask 4 targeted questions via NotebookLM chat
 *   4. Use Claude to structure answers into actionable JSON
 *   5. Return { problems, automationOpportunities, proposalAngles, sources, notebookUrl }
 *
 * @param {string}   clientUrl  - Client website URL
 * @param {string}   clientName - Client name (used as notebook title)
 * @param {string[]} [extraUrls] - Additional sources (LinkedIn, PDFs, etc.)
 * @returns {Promise<Object>}
 */
async function researchClient(clientUrl, clientName, extraUrls = []) {
  console.log(`\n🔍 Researching: ${clientName}`);
  console.log(`   URL: ${clientUrl}\n`);

  // Step 1: Create notebook
  console.log('1/5  Creating notebook...');
  nlm(`create "Research: ${clientName}"`);

  // Step 2: Add sources
  console.log('2/5  Adding sources...');
  nlm(`source add "${clientUrl}"`);
  for (const url of extraUrls) {
    nlm(`source add "${url}"`);
  }

  // Step 3: Ask targeted research questions
  const questions = [
    'What are the biggest operational problems or inefficiencies this business likely faces?',
    'What business processes here could be automated with AI or software?',
    'What is their apparent target customer, value proposition, and competitive edge?',
    'If you were writing a cold outreach proposal for AI automation services to this business, what angle would resonate most?',
  ];

  console.log('3/5  Asking research questions via NotebookLM...');
  const rawAnswers = {};
  for (const q of questions) {
    process.stdout.write(`   → ${q.slice(0, 60)}...`);
    try {
      rawAnswers[q] = nlm(`ask "${q.replace(/"/g, "'")}"`);
      console.log(' ✓');
    } catch (e) {
      rawAnswers[q] = `Error: ${e.message}`;
      console.log(' ✗');
    }
  }

  // Step 4: Use Claude to structure into proposal-ready JSON
  console.log('4/5  Structuring insights with Claude...');
  const client = getAnthropicClient();

  const structureResponse = await client.messages.create({
    model:      'claude-opus-4-6',
    max_tokens: 4096,
    thinking:   { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: `You are Nuri, an AI Business OS. You receive raw research answers about a potential client and must structure them into a concise, actionable JSON object that Isaac can use to write a winning proposal. Return ONLY valid JSON, no markdown fences.`,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
Website: ${clientUrl}

Research answers from NotebookLM:

${Object.entries(rawAnswers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n')}

Structure this into JSON with these exact keys:
{
  "client": "${clientName}",
  "website": "${clientUrl}",
  "summary": "2-sentence business description",
  "problems": ["problem1", "problem2", "problem3"],
  "automationOpportunities": [
    { "process": "name", "impact": "high|medium|low", "description": "what to automate" }
  ],
  "proposalAngles": [
    { "angle": "headline angle", "hook": "opening line for cold outreach" }
  ],
  "targetBuyer": "who to contact and why",
  "suggestedServices": ["service1", "service2"],
  "researchedAt": "${new Date().toISOString()}"
}`,
    }],
  });

  const structText = structureResponse.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let insights;
  try {
    const clean = structText.replace(/```json\n?|\n?```/g, '').trim();
    insights = JSON.parse(clean);
  } catch {
    insights = { raw: structText, client: clientName, website: clientUrl };
  }

  // Step 5: Attach notebook URL from session
  const sessionPath = path.join(os.homedir(), '.openclaw', '.nlm-session.json');
  try {
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    insights.notebookUrl = session.notebookUrl;
    insights.sources     = session.sources;
  } catch { /* session may not exist */ }

  console.log('5/5  Done.\n');
  return insights;
}

module.exports = { researchClient, structureAnswer };
