# Portfolio dashboard

Read every store you hold a token for and write one HTML and Markdown dashboard of the tests running across the whole portfolio.

Built for agencies and multi-store merchants. One token reaches one shop, so the job is a loop over tokens.

> **The API is not live yet.** `api.abconvert.io` starts accepting requests when the API ships, so you cannot run this against production today. The script matches the published contract and will be verified against a dev store before general availability.

## What it does

For each store token:

1. Lists tests with `GET /v1/experiments?status=active` and `GET /v1/experiments?status=paused`.
2. Fetches each test with `GET /v1/experiments/{id}` for its test group names and its `started_at`.
3. Reads `GET /v1/experiments/{id}/results` for the verdict, the SRM check, and the best test group.

Then it writes `out/portfolio.html` and `out/portfolio.md`, sorted longest running first, because those are the tests due a decision.

You run it. A nightly cron entry, a scheduled GitHub Action, or an n8n schedule trigger all work. ABConvert does not push you a nightly digest, and webhook triggers are not available yet.

## Setup

```bash
export ABCONVERT_API_TOKENS="northwind=abcv_live_aaa,acme=abcv_live_bbb"
node examples/portfolio-dashboard/dashboard.mjs
open out/portfolio.html
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ABCONVERT_API_TOKENS` | yes | | Comma separated `label=token` pairs, one per store. Read scope is enough. |
| `ABCONVERT_API_TOKEN` | | | Accepted instead, for a single store. |
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | Override for a dev backend. |
| `DASHBOARD_OUT_DIR` | no | `./out` | Where the two files land. |
| `DASHBOARD_STATUSES` | no | `active,paused` | Which statuses to include. |
| `REQUEST_SPACING_MS` | no | `1100` | Delay between tests, to stay inside 60 reads per minute. |

The label is yours. It appears in the dashboard and in the logs. The script prints only the last 4 characters of a token, so a log you paste into a ticket does not leak one.

## Reading the walkthrough

### One token, one shop

A token is scoped to a single shop. There is no cross-store endpoint and no organization-level token. Holding 30 stores means holding 30 tokens and making 30 passes. Keep them in your secret manager and read them in at run time.

### The list endpoint has no results

The list endpoint takes `status`, `type`, `created_at[gte]`, `created_at[lte]`, `scheduled`, `cursor`, and `limit`. It does not take an `include` parameter, and list rows carry no results and no `changes` on their test groups.

So each row on this dashboard costs two extra reads: one `GET /v1/experiments/{id}` for the names, one `GET /v1/experiments/{id}/results` for the numbers. Budget for it.

### Pacing against the rate limit

Each token gets 60 reads per minute. A store with 12 tests costs 1 list read plus 24 detail reads. At 40 stores that is a lot of requests in a row, so the script sleeps `REQUEST_SPACING_MS` between tests.

`lib/abconvert.mjs` also honors `Retry-After` on a 429 and retries, so a burst recovers on its own. The spacing is there to keep you from spending the whole minute in the first two seconds and then waiting.

### One store failing does not sink the run

A revoked token, a shop with API access turned off, or a single test that 404s is recorded as an error row and the run continues. Both output files carry an **Errors** section, so a silent partial dashboard is not possible.

### Reading the output

- **Days** counts whole days since `started_at`. A long-running test with a `verdict` is the first thing to act on.
- **Result** shows the platform's `verdict`, unless `srm_status` is `mismatch`, in which case it shows the mismatch instead. A broken traffic split makes the verdict untrustworthy, so the dashboard leads with it.
- **Best test group** is the non-control test group with the highest `lift` on the test's `primary_metric`, quoted with its interval. A lift whose interval spans zero is not a result yet, which is why the interval is on the same line.

## Ask Claude

> "Build me a table of every test running across all my stores, sorted by how long it has been running."

> "Across all my active tests, which one has the highest probability of beating Control on revenue per visitor?"

> "List every test that has been running longer than 21 days and tell me which ones have enough traffic to call."

## Common mistakes

- **Expecting one token to see several stores.** It cannot. Collect one token per store.
- **Reading results off the list response.** They are not there. Fetch the snapshot per test.
- **Firing all stores in parallel with no pacing.** You will spend the minute's read budget instantly and spend the rest of the run in backoff.
- **Ranking by lift alone.** Sort by lift if you like, but show the interval next to it, or the dashboard will make a noisy 30% swing on 80 visitors look like the best result in the portfolio.
- **Committing the output.** `out/` holds store names and traffic figures. It is in `.gitignore` for a reason.
