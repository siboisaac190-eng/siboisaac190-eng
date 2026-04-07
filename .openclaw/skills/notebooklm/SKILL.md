# NotebookLM Skill

Nuri can use NotebookLM as a research and content generation tool via browser automation.
All commands persist state in `~/.openclaw/.nlm-session.json` (active notebook ID + context).

---

## 1. Client Research Before Outreach

Research any prospect before sending a proposal:

```bash
notebooklm create "Client: Masa Mara"
notebooklm source add "https://masamara.co.za"
notebooklm source add "https://linkedin.com/company/masa-mara"
notebooklm ask "What are their biggest operational problems?"
notebooklm ask "What automation would save them the most time?" --json
```

Or use Nuri's built-in `researchClient()` function which does all of the above in one call:

```js
const insights = await researchClient("https://masamara.co.za", "Masa Mara")
// Returns: { problems, automationOpportunities, proposalAngles, sources }
```

---

## 2. Audio Summaries for Deliverables

Generate a podcast-style brief for a client to review:

```bash
notebooklm generate audio "executive summary" --wait
notebooklm download audio ./client-brief.mp3
```

Or via the full pipeline (research → audio in one step):

```bash
./audio-factory.sh "Masa Mara automation audit" "Masa Mara"
```

---

## 3. Proposal Research Notebooks

Build a multi-source research notebook for a proposal:

```bash
notebooklm create "Proposal: Masa Mara"
notebooklm source add "https://masamara.co.za"          # client site
notebooklm source add "https://competitor.co.za"        # competitor
notebooklm source add "./industry-report.pdf"           # local file
notebooklm ask "What differentiates their competitors?"
notebooklm ask "What ROI claims resonate in this sector?" --json
```

---

## 4. Training Materials for Clients

Generate quizzes, flashcards, and slide decks from any source set:

```bash
notebooklm generate quiz --difficulty medium
notebooklm generate flashcards
notebooklm generate slide-deck
```

---

## Environment Setup

Add to `~/.openclaw/.env`:

```
NLM_COOKIES_PATH=~/.openclaw/nlm-cookies.json   # export from Chrome after login
ANTHROPIC_API_KEY=sk-ant-...                     # for researchClient()
BRAVE_SEARCH_API_KEY=...                         # optional, improves research
```

To export cookies:
1. Log into notebooklm.google.com in Chrome
2. Install "Cookie-Editor" extension
3. Click Export All → save as `~/.openclaw/nlm-cookies.json`

---

## CLI Reference

| Command | Description |
|---|---|
| `notebooklm create "<title>"` | Create a new notebook (saves ID to session) |
| `notebooklm use "<id or title>"` | Switch to an existing notebook |
| `notebooklm list` | List all notebooks |
| `notebooklm source add "<url or path>"` | Add a URL or local file as a source |
| `notebooklm sources` | List current sources |
| `notebooklm ask "<question>"` | Ask a question, print plain text answer |
| `notebooklm ask "<question>" --json` | Ask and return structured JSON |
| `notebooklm generate audio "<title>"` | Trigger Audio Overview generation |
| `notebooklm generate audio "<title>" --wait` | Generate and wait until ready |
| `notebooklm download audio <path>` | Download the audio file |
| `notebooklm generate quiz [--difficulty easy\|medium\|hard]` | Generate a quiz |
| `notebooklm generate flashcards` | Generate flashcards |
| `notebooklm generate slide-deck` | Generate a slide deck outline |
| `notebooklm status` | Show current notebook and source count |
