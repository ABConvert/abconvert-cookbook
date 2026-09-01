# ABConvert cookbook

Runnable recipes for the [ABConvert](https://abconvert.io) public REST API. Each example is one directory, one walkthrough, and one Node.js script you can read end to end in a few minutes.

ABConvert runs A/B tests on Shopify stores: price, shipping, theme, template, URL redirect, checkout, and offer tests. The API lets you create those tests, move them through their lifecycle, read results, and export order-level data from your own code. The contract lives in the [API reference](https://docs.abconvert.io/api-reference/overview); this repository is the shortest path from a token to working code. The API calls the object an `experiment`; these docs say **test**, matching the ABConvert admin.

## Start here

Work through the examples in order. Each one adds one API pattern to the last.

| | Example | What you learn |
|---|---|---|
| 1 | [`portfolio-dashboard`](examples/portfolio-dashboard/) | Read every store you hold a token for with `?include=results_summary` and write one HTML and Markdown dashboard. Read scope, output on the first run. |
| 2 | [`order-export`](examples/order-export/) | Start an async order export, poll the job, download the CSV, and analyze it locally. The async-job pattern, still on read scope. |
| 3 | [`slack-report`](examples/slack-report/) | Find tests that hit day 7 or day 14, read a per-day breakdown, summarize with Claude, and post to a Slack webhook. Composing the API with other services. |
| 4 | [`guardrail-monitor`](examples/guardrail-monitor/) | Poll every active test and pause one when a guardrail metric breaches your threshold. The only recipe that writes; run it with `DRY_RUN=1` first. |

Prefer to drive the API with an agent instead of a script? [`ask-claude.md`](ask-claude.md) holds verbatim prompts, and [`skills/abconvert-public-api/`](skills/abconvert-public-api/) is a skill you drop into your own `.claude/skills/` so the agent knows the contract. Both paths are first class.

Every script imports [`lib/abconvert.mjs`](lib/abconvert.mjs), the shared client: auth, pagination, the error envelope, rate-limit backoff, and the formatting the results snapshot needs.

## Get a token

1. Open the ABConvert admin.
2. Go to **Settings > Integrations**.
3. Create a token and copy it. The plaintext is shown once.

A token belongs to one shop and reaches that shop only. New tokens default to read scope, which runs examples 1 to 3; only the guardrail monitor needs write scope to pause a test. [Authentication](https://docs.abconvert.io/api-reference/authentication) covers scopes. Treat a token like a password: keep it in your secret manager, never in client-side code or a repository.

## Run your first example

```bash
git clone https://github.com/ABConvert/abconvert-cookbook.git
cd abconvert-cookbook
cp .env.example .env        # then put your token in it
set -a; source .env; set +a
node examples/portfolio-dashboard/dashboard.mjs
```

Node 20 or later. No dependencies, no build step, no framework.

Every script reads two environment variables; each example's README lists the ones it adds.

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."
export ABCONVERT_API_BASE="https://api.abconvert.io/v1"   # optional, this is the default
```

## Before you write your own client

The [API overview](https://docs.abconvert.io/api-reference/overview) is the canonical home for the behavior every integration hits: the error envelope, [rate limits](https://docs.abconvert.io/api-reference/overview#rate-limits), [idempotency](https://docs.abconvert.io/api-reference/overview#idempotency), and pagination. Three of its rules shape every recipe here:

- **The API does not send webhooks, and you run every loop.** Point cron, a GitHub Action, or an agent at these scripts; the API answers requests. The native [schedule window](https://docs.abconvert.io/api-reference/experiments/set-the-schedule-window) is the only automation it runs for you.
- **Results arrive as a snapshot.** [`GET /v1/experiments/{id}/results`](https://docs.abconvert.io/api-reference/results/retrieve-the-results-snapshot) answers 202 with `Retry-After` until one is computed. That is not an error; `lib/abconvert.mjs` returns `null` for it.
- **Money is a decimal string, and `lift` can be null.** Parse `amount` as a decimal and print it as sent; when no percentage against Control exists, read `difference` instead. The results reference names the cases, and `describeComparison` in the client handles both.

## Reference

- API reference and OpenAPI contract: <https://docs.abconvert.io/api-reference/overview>

## License

MIT. See [LICENSE](LICENSE).
