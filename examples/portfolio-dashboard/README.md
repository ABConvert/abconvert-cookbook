# Portfolio dashboard

Read every store you hold a token for and write one HTML and one Markdown dashboard of the tests running across the whole portfolio.

## What it does

For each store token:

1. Lists tests with `GET /v1/experiments?status=active&include=results_summary`, and the same call for `status=paused`. One read covers a page of 100 tests. Each row carries its results summary: outcome, SRM check, sample size, and the six metrics per test group.
2. Reads `GET /v1/experiments/{id}/results` for the tests the summary says are decided, because lift, difference, intervals, and p-values live on that endpoint alone.

It writes `out/portfolio.html` and `out/portfolio.md`, sorted longest running first. Run it from your own scheduler: a nightly cron entry, a scheduled GitHub Action, or an n8n schedule trigger. ABConvert does not send a nightly digest, and webhooks are not available yet.

A revoked token, a shop with API access turned off, or a single test that 404s becomes an error row, and the run continues. Both files show an **Errors** section when there is one.

[`dashboard.mjs`](dashboard.mjs) explains the mechanics inline, next to the code: why one token reaches one shop, what the summary carries versus the snapshot, pacing against 60 reads per minute, and ranking on `difference` instead of `lift`.

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
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | You rarely need to set it. |
| `DASHBOARD_OUT_DIR` | no | `./out` | Where the two files land. |
| `DASHBOARD_STATUSES` | no | `active,paused` | Which statuses to include. |
| `DASHBOARD_DETAIL` | no | `decided` | Which tests get a full snapshot read: `decided` (outcome `winner` or `loser`), `all`, or `none`. |
| `REQUEST_SPACING_MS` | no | `1100` | Delay before each snapshot read, to stay inside 60 reads per minute. |

The label is yours. It appears in the dashboard and in the logs, where the script prints only the last 4 characters of a token.

## Reading the output

- **Days** counts whole days since `started_at`.
- **Visitors** sums `sample_size` across the test groups in the summary.
- **Result** shows the platform's `outcome`, or `SRM mismatch` when `srm_status` is `mismatch`. Treat a mismatch as invalidating the outcome.
- **Best test group** is the non-control test group whose `difference` on the test's `primary_metric` is largest. It is quoted with its interval: `Variant A +71.6% (+19.9% to +123.3%)`. An interval that spans zero is not a result yet. When a run did not read a test's snapshot, the row says `snapshot not read` instead of going blank.

## Ask Claude

> "Build me a table of every test running across all my stores, sorted by how long it has been running."

> "Across all my active tests, which one has the highest probability of beating Control on revenue per visitor?"

> "List every test that has been running longer than 21 days and tell me which ones have enough traffic to call."

## Common mistakes

- **Expecting one token to see several stores.** It cannot. Collect one token per store. 30 stores means 30 tokens and 30 passes.
- **Acting on `results_summary` alone.** It carries no interval and no p-value. Read the snapshot before you call a result.
- **Firing all stores in parallel with no pacing.** You will spend the minute's read budget instantly and spend the rest of the run in backoff.
- **Ranking by lift alone.** Lift hides every test group where it is null. It also needs its interval: without one, a noisy 30% swing on 80 visitors looks like the best result in the portfolio.
- **Committing the output.** `out/` holds store names and traffic figures. It is already in `.gitignore`. Keep it there.
