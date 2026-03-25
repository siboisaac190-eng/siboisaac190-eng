# Sibomana Isaac

**AI Automation Engineer** — Cape Town, South Africa

I build autonomous systems that run businesses. Not demos. Not toys. Systems that wake up at 6:50am, check emails, scan Upwork, track revenue, fix their own bugs, and report back to me on Telegram — while I sleep.

---

## What I'm Building Right Now

**Nuri** — an AI Business Operating System that runs 24/7 on my MacBook Air M1.

```js
// Every morning at 6:50am, Nuri wakes up and does this:

async function morningBrief() {
  const goals    = await goalEngine.getStatus();        // $8,333/month target
  const jobs     = await blackboard.queryLatest('upwork_jobs');  // fresh Upwork leads
  const revenue  = await blackboard.queryLatest('shopify_orders'); // overnight sales
  const insights = await reflector.getLastNight();      // what worked, what failed

  const brief = await gemini.generate({
    prompt: `You are Nuri. Isaac wakes up in 10 minutes.
             Give him a sharp, actionable morning brief.`,
    context: { goals, jobs, revenue, insights }
  });

  await telegram.send(ISAAC_CHAT_ID, brief);
}
```

This runs every day. No manual input. No babysitting.

---

## The Architecture

Nuri has 4 layers of intelligence:

```
Layer 1 — Reactive      Responds to Telegram commands, Shopify webhooks
Layer 2 — Scheduled     Morning brief, job scanning, revenue checks (cron)
Layer 3 — Autonomous    Self-monitors, auto-restarts on crash, emails Claude Code for bug fixes
Layer 4 — Self-Improving  Reflection Agent reviews every day, updates strategy, writes new skills
```

### Layer 4 in action — Nuri emails me (Claude Code) when it crashes 3x in an hour:

```js
// gateway-monitor.js — runs every 60 seconds

function checkCrashThreshold(errorMsg) {
  crashCount++;
  if (crashCount >= 3) {
    const emailBridge = require('./email-bridge');
    emailBridge.reportBugToClaude(errorMsg, getLatestLogs())
      .then(() => log('Bug report emailed to Claude Code'));
    // Claude Code reads the email, fixes the code, replies
    // Nuri picks up the reply at 6:50am via IMAP
    // Isaac gets a Telegram: "Bug fixed automatically"
  }
}
```

### The Revenue Engine — tracking $8,333/month across 3 streams:

```js
// goal-engine.js

const STREAMS = {
  upwork:  { target: 5000 },   // AI automation freelancing
  gumroad: { target: 2000 },   // digital products
  shopify: { target: 1333 },   // e-commerce
};

async function recordRevenue(stream, amount) {
  state[stream].earned += amount;
  const pct = state[stream].earned / state[stream].target;

  if (pct >= 0.5 && !milestones[`${stream}_50`]) {
    milestones[`${stream}_50`] = true;
    await telegram.send(CHAT_ID, `${stream} hit 50% of monthly target`);
  }
  // fires at 25%, 50%, 75%, 100%
}
```

---

## Stack

![Node.js](https://img.shields.io/badge/Node.js_22-339933?style=flat&logo=node.js&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini_3.1_Pro-4285F4?style=flat&logo=google&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram_Bot_API-26A5E4?style=flat&logo=telegram&logoColor=white)
![Shopify](https://img.shields.io/badge/Shopify_Webhooks-96BF48?style=flat&logo=shopify&logoColor=white)
![Gmail](https://img.shields.io/badge/Gmail_SMTP%2FIMAP-EA4335?style=flat&logo=gmail&logoColor=white)
![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?style=flat&logo=googlecloud&logoColor=white)

Everything runs on **Node.js built-in modules** — no bloated dependencies, no framework lock-in.

---

## GitHub Stats

![Sibomana Isaac's GitHub stats](https://github-readme-stats.vercel.app/api?username=siboisaac190-eng&show_icons=true&theme=dark&hide_border=true&count_private=true)

---

## What I Can Build for You

| You need | I deliver | Timeline |
|---|---|---|
| Telegram bot with AI + commands | Production-ready, single-file, no npm | 2-3 days |
| Shopify → Telegram/Slack notifications | HMAC-verified webhook handler | 1-2 days |
| Autonomous AI agent for your workflow | Plans, executes, reports back | 3-5 days |
| Revenue/KPI tracking automation | Real-time alerts + daily reports | 2-3 days |
| Any Node.js API integration | Clean, tested, documented | 1-4 days |

See the code: [ai-automation-portfolio](https://github.com/siboisaac190-eng/ai-automation-portfolio)

---

*Available for freelance contracts · Response time under 4 hours*
