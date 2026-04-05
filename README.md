# Sibomana Isaac

**AI Automation Engineer** — Cape Town, South Africa

I build autonomous AI systems that run real business operations. Nuri — my own AI Business OS — scans jobs, writes proposals, tracks revenue, and reports to me on Telegram every morning. All without me touching it.

---

## Nuri — Autonomous AI Business OS

```
Architecture (March 2026)
─────────────────────────────────────────────────────
  Telegram  ──▶  brain-router  ──▶  research-agent
                     │                    │
                     │              writing-agent
                     │                    │
                 goal-engine        execution-agent
                     │                    │
                  RAG (3,233 chunks)  Telegram send
─────────────────────────────────────────────────────
  Score: 83/100 │ Vector DB: 131MB │ Cron: 10 jobs
```

**What it does every day, automatically:**
- 6am — Scans RemoteOK RSS for AI/Node.js jobs, scores with Gemini
- 7am — Morning brief delivered to Telegram
- 9am — Top jobs queued, proposals written via RAG-enhanced Gemini
- Tracks applications + revenue from natural language messages
- Self-evaluates across 4 levels (components → trajectory → outcomes → system)

---

## RAG Knowledge Base

3,233 chunks across 300 sources — Nuri answers questions from its own indexed knowledge:

| Source | Chunks |
|--------|--------|
| 6 research papers (HyperAgents, ReAct, MemGPT, AutoGen, RAG, Self-RAG) | 323 |
| Anthropic cookbook + Claude agent SDK docs | ~200 |
| Gemini API reference + cookbook | ~180 |
| 147 own skill/knowledge files | 1,617 |
| Prompt Engineering Guide | ~150 |

```js
// Every response is RAG-enhanced:
const hits = await searchKnowledge(task, 3);   // cosine similarity, gemini-embedding-001
const context = hits.map(h => h.text).join('\n');
return gemini.generate(`${context}\n\nAnswer: ${task}`);
```

---

## Revenue Pipeline (Target: $8,333/month)

| Stream | Target | Status |
|--------|--------|--------|
| Upwork — AI automation freelancing | $5,000/mo | Scanning daily |
| Gumroad — digital products | $2,000/mo | In progress |
| Shopify — e-commerce | $1,333/mo | Webhook live |

Goal tracked in real-time. Tell Nuri "applied to X" or "got paid $Y" — it records it automatically.

---

## Services

| Package | What | Price |
|---------|------|-------|
| AI Chat Bot | 24/7 support on WhatsApp/Telegram | R8,000 + R2,000/mo |
| Document Intelligence | Extract data from invoices, contracts | R20,000 + R3,000/mo |
| Business Knowledge Base | AI trained on your company docs | R15,000 + R3,500/mo |
| Autonomous Agent | Monitors + acts without human input | R35,000 + R8,000/mo |

---

## Stack

![Node.js](https://img.shields.io/badge/Node.js_22-339933?style=flat&logo=node.js&logoColor=white)
![Claude](https://img.shields.io/badge/Claude_Sonnet_4.6-D97706?style=flat&logo=anthropic&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini_3.1_Pro-4285F4?style=flat&logo=google&logoColor=white)
![Vertex AI](https://img.shields.io/badge/Vertex_AI-4285F4?style=flat&logo=google&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram_Bot_API-26A5E4?style=flat&logo=telegram&logoColor=white)
![Shopify](https://img.shields.io/badge/Shopify-96BF48?style=flat&logo=shopify&logoColor=white)
![RAG](https://img.shields.io/badge/RAG-131MB_vector_DB-blueviolet?style=flat)

![GitHub Stats](https://github-readme-stats.vercel.app/api?username=siboisaac190-eng&show_icons=true&theme=dark&hide_border=true&count_private=true)

---

**Available on Upwork · Response under 4 hours · Cape Town, SA**

Code: [nuri-openclaw](https://github.com/siboisaac190-eng/nuri-openclaw) · [ai-automation-portfolio](https://github.com/siboisaac190-eng/ai-automation-portfolio)
