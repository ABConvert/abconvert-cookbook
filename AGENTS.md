# AGENTS.md

This is a cookbook of runnable examples for the ABConvert public API. The API contract lives at https://docs.abconvert.io/api-reference/overview.

- Scripts run on Node 20+ with no dependencies and no build step: `node examples/<name>/<script>.mjs`.
- `lib/abconvert.mjs` is the shared client every example imports.
- `skills/abconvert-public-api/SKILL.md` is the condensed contract an agent reads; keep it consistent with the API reference when editing.
- Each README's "Ask Claude" section holds the reader-facing prompts.
- Copy `.env.example` to `.env` for configuration.
