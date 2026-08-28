# ABConvert cookbook

Runnable recipes for the [ABConvert](https://abconvert.io) public REST API. Each example is one directory, one walkthrough, and one Node.js script you can read end to end in a few minutes.

ABConvert runs A/B tests on Shopify stores: price, shipping, theme, template, URL redirect, checkout, and offer tests. The API lets you create those tests, move them through their lifecycle, read results, and export order-level data from your own code.

## What is in here

| Example | What it does |
|---|---|
| [`examples/slack-report/`](examples/slack-report/) | Finds tests that hit day 7 or day 14, reads their results with a per-day breakdown, summarizes them with Claude, and posts to a Slack webhook. |
| [`examples/guardrail-monitor/`](examples/guardrail-monitor/) | Polls results for every active test and pauses one when a guardrail metric breaches your threshold. |
| [`examples/portfolio-dashboard/`](examples/portfolio-dashboard/) | Reads every store you hold a token for with `?include=results_summary` and writes one HTML and Markdown dashboard. |
| [`examples/order-export/`](examples/order-export/) | Starts an async order export, polls the job, downloads the CSV, and runs a local analysis. |
| [`skills/abconvert-public-api/`](skills/abconvert-public-api/) | A Claude skill you can drop into your own `.claude/skills/` so an agent drives the API correctly. |
| [`AGENTS.md`](AGENTS.md) | The agent path: verbatim prompts you can paste into Claude Code, Cursor, or your own agent. |
| [`lib/abconvert.mjs`](lib/abconvert.mjs) | The shared client every example imports. Auth, pagination, the error envelope, rate-limit backoff, and the money and comparison formatting the results snapshot needs. |

## Get an API token

1. Open the ABConvert admin.
2. Go to **Settings > Integrations**.
3. Create a token and copy it. The plaintext is shown once.

A token belongs to one shop and reaches that shop only. If you manage several stores, hold one token per store.

Tokens carry scopes:

| Scope | Grants |
|---|---|
| `read_experiments` | List and retrieve tests, read results, and create, poll, and download exports |
| `write_experiments` | Everything read grants, plus create, update, lifecycle actions, and schedule changes |

`GET` requests need read. Every other method needs write, except `POST /v1/experiments/{id}/results` and `POST /v1/experiments/{id}/exports`, which read data and change nothing about the test. New tokens default to read, so grant write only to the integrations that manage tests. Of the examples here, only the guardrail monitor needs a write token.

Treat a token like a password. Keep it in your secret manager, never in client-side code or a repository. Revoking a token in the admin takes effect immediately.

## Base URL and configuration

Every script reads two environment variables:

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."
export ABCONVERT_API_BASE="https://api.abconvert.io/v1"   # optional, this is the default
```

Individual examples add their own variables. Each README lists them.

Send the token as a bearer token on every request:

```bash
curl https://api.abconvert.io/v1/experiments \
  --header "Authorization: Bearer $ABCONVERT_API_TOKEN"
```

## Who runs the loop

**You run every loop, timer, and job.** The API answers requests. It does not call you back, and it does not run your automation on your behalf.

- Scheduling an hourly poll, a nightly report, or a retry queue is your job, in whatever runs it: cron, n8n, Zapier, a GitHub Action, a Lambda, or an agent.
- ABConvert executes exactly one timer of its own: the native scheduler, which starts and ends a test inside the window you set with `PUT /v1/experiments/{id}/schedule`.
- Webhook triggers are not available yet. Every flow in this cookbook polls. Push triggers arrive in a later version, and the polling recipes keep working when they do.

That boundary is why each example ships as a plain script with no runtime of its own. Point your scheduler at it.

## Rate limits

Each token gets 60 reads and 10 writes per minute. `GET` is a read; everything else is a write.

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. A 429 also carries `Retry-After` in seconds. `lib/abconvert.mjs` honors it and backs off; if you write your own client, honor it too, and never busy-loop writes.

Because a portfolio job multiplies requests by store count, read the pacing note in [`examples/portfolio-dashboard/README.md`](examples/portfolio-dashboard/README.md) before you point one at 40 stores.

## Errors

Every error uses one shape on every status code:

```json
{
  "error": {
    "type": "validation_error",
    "code": "split_sum_invalid",
    "message": "Splits across test groups must sum to 100.",
    "param": "test_groups",
    "findings": [
      { "severity": "error", "code": "split_sum_invalid", "param": "test_groups", "message": "..." }
    ]
  }
}
```

- `type` is one of `invalid_request_error`, `authentication_error`, `permission_error`, `not_found_error`, `conflict_error`, `validation_error`, `rate_limit_error`, `api_error`.
- A 422 lists every blocking finding in `findings`. Fix all of them and retry once, rather than one at a time.
- A 409 `invalid_status_transition` carries `details.allowed_actions`, so branch on that instead of parsing the message.
- A success response can carry a top-level `warnings` array. A 2xx with warnings is not a clean pass. Print them.

`lib/abconvert.mjs` turns any error response into an `AbconvertApiError` whose `describe()` prints the status, type, code, message, and every finding.

## Reading results

`GET /v1/experiments/{id}/results` answers 202 while the pipeline has not computed a snapshot yet. That is not an error and it is not JSON: treat it as "no data yet" and come back later. `lib/abconvert.mjs` returns `null` for it. Results refresh at most every few hours, so polling faster returns the same snapshot with an unchanged `computed_at`.

Two shapes in the snapshot catch people out, and every example here handles both:

**Money is an object, and its decimals matter.** `revenue_per_visitor`, `average_order_value`, `profit_per_visitor`, and `revenue` come back as `{"amount": "3.87", "currency": "USD"}`, as do the comparison fields derived from them. `amount` is a decimal string carrying as many places as the measurement needs, so an expected loss of `"0.004"` is real. Parse it as a decimal, print it as sent, and never round to two places.

**A comparison can have a difference and no percentage.** Each metric under `vs_control` carries both `difference` (always statable, in the metric's own unit) and `lift` (the same change as a fraction of Control). `lift` is null when Control's value is zero, and when Control and the test group sit on opposite sides of zero, which `profit_per_visitor` reaches whenever costs cross revenue. `confidence_interval` and `credible_interval` bound `lift`, so they are null there too.

So read `difference` for direction and size, quote `lift` only when it is there, and fall back to `frequentist.difference_interval` for the bound:

```js
import { describeComparison } from "./lib/abconvert.mjs";

// "+6.2% (-1.1% to +13.4%)", or "+0.41 USD vs Control (-0.06 USD to +0.88 USD; ...)"
describeComparison(group.vs_control.profit_per_visitor, { metric: "profit_per_visitor" });
```

Every metric field is nullable. Guard each one you read.

## Terminology

The API calls the object an `experiment`: endpoints, fields, and identifiers all use that word. These docs call it a **test**, which matches the ABConvert admin. Field names in code stay exactly as the contract defines them.

A test holds two or more **test groups**. The default names are `Control`, `Variant A`, and `Variant B`. Merchants rename them freely, so read the names off the test rather than assuming the defaults. A visitor is assigned to a test group, which might be Control.

`product variant` always means the Shopify catalog object. A bare `variant` always means an A/B test group.

## Requirements

Node 20 or later. No dependencies, no build step, no framework. Every script uses the global `fetch`.

```bash
git clone https://github.com/ABConvert/abconvert-cookbook.git
cd abconvert-cookbook
cp .env.example .env        # then put your token in it
set -a; source .env; set +a
node examples/portfolio-dashboard/dashboard.mjs
```

## Reference

- API reference and OpenAPI contract: <https://docs.abconvert.io/api-reference/overview>
- The skill in [`skills/abconvert-public-api/`](skills/abconvert-public-api/) is the condensed version an agent reads.

## License

MIT. See [LICENSE](LICENSE).
