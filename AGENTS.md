# AGENTS.md

This is a cookbook of runnable examples for ABConvert's two developer surfaces. One top-level directory per surface; each is self-contained.

- `public-api/`: REST API examples. Scripts run on Node 20+ with no dependencies and no build step: `node public-api/examples/<name>/<script>.mjs`. `public-api/lib/abconvert.mjs` is the shared client every example imports. Contract: https://docs.abconvert.io/api-reference/overview.
- `browser-api/`: storefront JavaScript examples for `window.ABConvert`. Each is one plain script a merchant adds to a theme. `browser-api/playground/` runs them against a mock; serve it with `python3 -m http.server` from `browser-api/`. Contract: https://docs.abconvert.io/api-reference/browser-api (also at `.md` for agents).
- `skills/abconvert-public-api/SKILL.md` is the condensed REST contract an agent reads; keep it consistent with the API reference when editing.
- Each surface README holds the reader-facing "Ask an agent" prompts.
- Copy `.env.example` to `.env` for the public API examples' configuration.
- Adding a surface: add a directory with its own README and examples, a row to the root README's table, and a bullet here.
