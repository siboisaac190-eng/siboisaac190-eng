# Openclaw Tool Registry

All tools available to Nuri. The gateway reads this file on startup and
registers each tool with Claude via the tool definitions array.

---

## web_search
Search the web for current information — addresses, phone numbers, business info,
news, prices, anything that may have changed recently.
- **Handler:** `plugins/agent-loop/index.js` → `execWebSearch`
- **Key:** `BRAVE_SEARCH_API_KEY` (optional, falls back to DuckDuckGo)

## web_fetch
Fetch and read the content of a URL.
- **Handler:** `plugins/agent-loop/index.js` → `execWebFetch`

## read_file
Read a local file by absolute or relative path.
- **Handler:** `plugins/agent-loop/index.js` → `execReadFile`

## shell
Run a shell command and return stdout. Restricted to safe commands.
- **Handler:** `plugins/agent-loop/index.js` → `execShell`

## get_disasters
Fetch current open NASA EONET disaster events near South Africa.
- **Handler:** `plugins/disaster-monitor/index.js` → `getCurrentDisasters`

## get_asteroids
Fetch potentially hazardous asteroids for the next 3 days.
- **Handler:** `plugins/disaster-monitor/index.js` → `getHazardousAsteroids`
- **Key:** `NASA_API_KEY`

## research_client
Research a business by URL using NotebookLM + Claude.
- **Handler:** `plugins/notebooklm-client/index.js` → `researchClient`
- **Keys:** `ANTHROPIC_API_KEY`, `NLM_COOKIES_PATH`

## generate_audio
Research a topic and generate a NotebookLM audio brief.
- **Handler:** `plugins/audio-factory/index.js` → `runAudioFactory`

---

## Status

| Tool             | Registered | Tested |
|------------------|------------|--------|
| web_search       | ✅         | ✅     |
| web_fetch        | ✅         | ✅     |
| read_file        | ✅         | ✅     |
| shell            | ✅         | ✅     |
| get_disasters    | ✅         | —      |
| get_asteroids    | ✅         | —      |
| research_client  | ✅         | ✅     |
| generate_audio   | ✅         | —      |
