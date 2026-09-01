# Portfolio dashboard

Read every store you hold a token for and write one HTML and one Markdown dashboard of the tests running across the whole portfolio.

## What it does

For each store token:

1. Lists tests with `GET /v1/experiments?status=active&include=results_summary`, and the same call for `status=paused`. One read per page of 100 tests, each row carrying its results summary: outcome, SRM check, sample size, and the six metrics per test group.
2. Reads `GET /v1/experiments/{id}/results` for the tests the summary says are decided.

It writes `out/portfolio.html` and `out/portfolio.md`, sorted longest running first, and runs from your own scheduler: a nightly cron entry, a scheduled GitHub Action, or an n8n schedule trigger. ABConvert does not push you a nightly digest, and webhook triggers are not available yet. A revoked token, a shop with API access turned off, or a single test that 404s is recorded as an error row and the run continues; both files carry an **Errors** section when there is one to show.

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
| `DASHBOARD_DETAIL` | no | `decided` | Which tests get a full snapshot read: `decided` (outcome `winner` or `loser`), `all`, or `none`. |
| `REQUEST_SPACING_MS` | no | `1100` | Delay before each snapshot read, to stay inside 60 reads per minute. |

The label is yours. It appears in the dashboard and in the logs, where the script prints only the last 4 characters of a token.

## Reading the walkthrough

### One token is scoped to one shop

Collect one token per store and loop. There is no cross-store endpoint and no organization-level token, so 30 stores means 30 tokens and 30 passes. Keep them in your secret manager and read them in at run time.

### The list read carries the summary, the snapshot carries the comparison

`?include=results_summary` inlines `computed_at`, `outcome`, `winning_test_group_index`, `srm_status`, and per test group the sample size and the six metrics. It is `null` for a test with no snapshot yet. Lift, difference, intervals, and p-values live on `GET /v1/experiments/{id}/results` alone, so the summary fills the table and the **Best test group** column fills in only for the rows whose snapshot this run read. `DASHBOARD_DETAIL` picks those rows: the default, `decided`, reads the snapshot for tests the platform already called a `winner` or a `loser`; `all` reads every one, `none` reads none. Rows it skipped say `snapshot not read` rather than showing a blank.

### Pace the snapshot reads against 60 reads per minute

Each token gets 60 reads per minute. A store with 12 active tests costs one list read, not 25, because the summary comes inlined and the list pages 100 tests at a time. Only the snapshot reads are extra, and the script sleeps `REQUEST_SPACING_MS` before each of those. `lib/abconvert.mjs` honors `Retry-After` on a 429 and retries, so a burst recovers on its own.

### Reading the output

- **Days** counts whole days since `started_at`.
- **Visitors** sums `sample_size` across the test groups in the summary.
- **Result** shows the platform's `outcome`, or `SRM mismatch` when `srm_status` is `mismatch`. Treat a mismatch as invalidating the outcome.
- **Best test group** is the non-control test group whose `difference` on the test's `primary_metric` is largest, quoted with its interval: `Variant A +71.6% (+19.9% to +123.3%)`. An interval that spans zero is not a result yet.

### Rank on `difference`, not `lift`

`lift` is null whenever Control's value is zero or Control and the test group sit on opposite sides of zero, so sorting on it drops the rows that moved most. Rank on `difference`, which every comparison carries ([results reference](https://docs.abconvert.io/api-reference/results/retrieve-the-results-snapshot)). `vs_control` is keyed by metric:

```js
      summary: describeComparison(group.vs_control[metric], { metric }),
      rank: comparisonRank(group.vs_control[metric]),
```

## Ask Claude

> "Build me a table of every test running across all my stores, sorted by how long it has been running."

> "Across all my active tests, which one has the highest probability of beating Control on revenue per visitor?"

> "List every test that has been running longer than 21 days and tell me which ones have enough traffic to call."

## Common mistakes

- **Expecting one token to see several stores.** It cannot. Collect one token per store.
- **Acting on `results_summary` alone.** It carries no interval and no p-value. Read the snapshot before you call a result.
- **Firing all stores in parallel with no pacing.** You will spend the minute's read budget instantly and spend the rest of the run in backoff.
- **Ranking by lift alone.** It hides every test group whose lift is null, and it needs the interval beside it, or a noisy 30% swing on 80 visitors looks like the best result in the portfolio.
- **Committing the output.** `out/` holds store names and traffic figures. It is already in `.gitignore`; keep it there.
