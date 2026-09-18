# AGENTS.md

This is a cookbook of runnable examples for ABConvert's two developer surfaces. One top-level directory per surface; each is self-contained.

- `rest-api/`: REST API examples. Scripts run on Node 20+ with no dependencies and no build step: `node rest-api/examples/<name>/<script>.mjs`. `rest-api/lib/abconvert.mjs` is the shared client every example imports. Contract: https://docs.abconvert.io/api-reference/overview.
- `javascript-api/`: JavaScript API examples, storefront scripts that read `window.ABConvert`. Each is one plain script you add to a theme. `javascript-api/playground/` runs them against a mock; serve it with `python3 -m http.server` from `javascript-api/`. Contract: https://docs.abconvert.io/api-reference/browser-api (also at `.md` for agents).
- `skills/abconvert-rest-api/SKILL.md` is the condensed REST contract an agent reads; keep it consistent with the API reference when editing.
- Each surface README holds the reader-facing "Ask an agent" prompts.
- Copy `.env.example` to `.env` for the REST API examples' configuration.
- Adding a surface: add a directory with its own README and examples, a row to the root README's table, and a bullet here.
