# Sibomana Isaac

**AI Automation Engineer** — Cape Town, South Africa

I build autonomous AI systems that handle real business operations. Not prototypes. Not tutorials. Production systems running on Google Vertex AI that generate measurable ROI for clients.

This week I built and shipped three client-ready demos:

---

## What I Shipped This Week

### 1. RAG Business Knowledge Base
```
Client asks: "What does our return policy say about electronics?"
System:      searches 200 company documents in 1.2 seconds
             returns: exact policy + source document
```
**Stack:** Vertex AI Agent Builder + Gemini 3.1 Pro + Node.js

### 2. Restaurant AI Support Bot
```
Customer:  "I want to book a table for 4 this Saturday at 7pm"
Bot:       "Lekker! Could I get your name? You can confirm
            by calling 021-555-0123."
```
Handles: menu queries, bookings, complaints, human escalation.
**Stack:** Gemini 3.1 Pro + Telegram Bot API (zero npm)

### 3. Invoice Data Extractor
```json
Input:  PDF invoice (any layout, any vendor)
Output: {
  "invoice_number": "INV-2024-0847",
  "vendor": { "name": "Tech Solutions (Pty) Ltd", "tax_id": "4890123456" },
  "line_items": [ { "description": "Website Dev", "amount": "8500.00" } ],
  "financials": { "subtotal": "R15,000", "vat": "R2,250", "total": "R17,250" }
}
```
**Stack:** Google Document AI Invoice Parser v2.0

---

## The Bigger System: Nuri

All three demos run as skills inside **Nuri** — my autonomous AI Business OS:

```js
// Every morning at 6:50am, this runs automatically:
async function morningBrief() {
  const goals   = await goalEngine.getStatus();      // $8,333/month target
  const jobs    = await blackboard.queryLatest('upwork_jobs');
  const orders  = await blackboard.queryLatest('shopify_orders');
  const brief   = await gemini.generate({ prompt: 'Sharp morning brief', context: { goals, jobs, orders } });
  await telegram.send(CHAT_ID, brief);
}
```

Nuri monitors itself, emails Claude Code when it crashes, fixes its own bugs, and reports back on Telegram. Level 4 autonomous AI agent.

---

## Service Menu

| Package | What | Price |
|---|---|---|
| AI Chat Bot | 24/7 customer support on WhatsApp/Telegram | R8,000 + R2,000/mo |
| Document Intelligence | Extract data from invoices, receipts, contracts | R20,000 + R3,000/mo |
| Business Knowledge Base | AI that knows everything about your business | R15,000 + R3,500/mo |
| Autonomous Agent | AI that monitors and acts without human input | R35,000 + R8,000/mo |
| Smart Search | Google-quality search for your business | R25,000 + R5,000/mo |

---

## Stack

![Vertex AI](https://img.shields.io/badge/Vertex_AI-4285F4?style=flat&logo=google&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini_3.1_Pro-4285F4?style=flat&logo=google&logoColor=white)
![Document AI](https://img.shields.io/badge/Document_AI-EA4335?style=flat&logo=google&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js_22-339933?style=flat&logo=node.js&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram_Bot_API-26A5E4?style=flat&logo=telegram&logoColor=white)
![Shopify](https://img.shields.io/badge/Shopify-96BF48?style=flat&logo=shopify&logoColor=white)

![GitHub Stats](https://github-readme-stats.vercel.app/api?username=siboisaac190-eng&show_icons=true&theme=dark&hide_border=true&count_private=true)

---

**Available for freelance on Upwork · Response under 4 hours · Cape Town, SA**

See the code: [ai-automation-portfolio](https://github.com/siboisaac190-eng/ai-automation-portfolio)
