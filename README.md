# ChatGPT History Meter

A lightweight Chromium browser extension that estimates the text size of the **active ChatGPT conversation branch** from conversation payloads already fetched by the page.

> **Important:** this is a **history meter**, not an authoritative context-window meter. ChatGPT may compact, summarize, retrieve, omit, or add context server-side. The extension cannot observe the effective prompt that is ultimately sent to the model.

## What it shows

- Estimated text tokens in the active conversation branch.
- A breakdown for user messages, ChatGPT replies, tool/search text, reasoning recap, and system/context entries present in history.
- The detected model slug when available.
- A configured model-window value used only as a **reference**.
- A history/reference ratio such as `0.82×`.
- `Effective prompt usage: Unknown` by design.

Token counts are heuristic estimates, not tokenizer-exact measurements.

## Privacy

ChatGPT History Meter runs locally in the browser:

- host access is limited to `https://chatgpt.com/*`;
- no extension storage permission is requested;
- no analytics or external server is used;
- no API keys are required;
- conversation text is processed in memory and is not persisted by the extension;
- console diagnostics contain counts and content-type summaries, not conversation text.

The extension passively observes ChatGPT conversation responses already fetched by the page. It does not make proactive conversation API requests.

## Installation

The current release is live-tested on Microsoft Edge. Other Chromium-based browsers may work, but are not yet verified here.

1. Download or clone this repository.
2. Open `edge://extensions` (or the equivalent extensions page in your Chromium browser).
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Open or hard-refresh a ChatGPT conversation.
7. Click the **History** badge to view details.

## Why this project exists

The original Context Window Meter relied on assumptions that no longer matched the ChatGPT frontend observed in 2026. This derivative version adds a compatibility path that consumes current conversation hydration payloads, follows the active branch, filters structured tool payloads conservatively, reduces duplicate diagnostics, and keeps the details card usable in short/high-zoom viewports.

The wording was intentionally changed from **context usage** to **conversation history** because raw history size is not the same as the effective model prompt.

## Development / regression checks

No build step is required for the unpacked extension.

With Node.js installed:

```bash
node --check page_script.js
node --check content.js
node test/test-parser.cjs
node test/test-layout.cjs
```

## Current limitations

- ChatGPT frontend/network internals are private implementation details and can change without notice.
- The model-window reference table is informational and may become stale.
- Token estimation is heuristic.
- Effective prompt size, server-side compaction boundaries, hidden prompt assembly, and retrieval behavior are not observable from conversation history alone.
- Live verification for this release was performed on Microsoft Edge; other browsers are not claimed as verified.

## Upstream and license

This project is derived from **Context Window Meter** by Joost Bakker:

https://github.com/joostmbakker/context-window-meter

The upstream project is licensed under the MIT License. The upstream copyright and MIT permission notice are retained in [`LICENSE`](LICENSE). See [`NOTICE.md`](NOTICE.md) for attribution and modification notes.

## Trademark / affiliation notice

This is an independent open-source project. It is **not affiliated with, endorsed by, or sponsored by OpenAI**. ChatGPT and OpenAI are trademarks of their respective owner.
