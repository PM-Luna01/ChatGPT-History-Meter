# Attribution and Modification Notice

ChatGPT History Meter is a derivative work based on:

- **Context Window Meter** by Joost Bakker
- Upstream repository: https://github.com/joostmbakker/context-window-meter
- Upstream license: MIT
- Upstream copyright: Copyright (c) 2026 Joost Bakker

The upstream MIT license text and copyright notice are preserved in `LICENSE`.

## Modifications in this repository

The 2026 compatibility work in this repository includes, among other changes:

- consuming ChatGPT conversation payloads already fetched by the page rather than relying on stale DOM selectors;
- resolving the active conversation branch;
- reframing the UI from authoritative "context usage" to estimated **conversation history** size;
- conservative extraction of human-readable text from structured tool/search payloads;
- role/content-type diagnostics without logging conversation text;
- duplicate-state suppression for quieter diagnostics;
- viewport-safe details-card scrolling and sticky header behavior;
- regression tests for parser filtering and layout behavior.

Modifications are distributed under the same MIT terms unless otherwise noted.
