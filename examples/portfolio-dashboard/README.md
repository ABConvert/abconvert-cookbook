# Portfolio dashboard

Read every store you hold a token for and write one HTML and Markdown dashboard of the tests running across the whole portfolio.

Built for agencies and multi-store merchants. One token reaches one shop, so the job is a loop over tokens.

## What it does

For each store token:

1. Lists tests with `GET /v1/experiments?status=active&include=results_summary` and the same call for `status=paused`. One read per page of 100 tests, with each test's results summary inlined: outcome, SRM check, sample size, and the six metrics per test group.
2. Reads `GET /v1/experiments/{id}/results` only for the tests the summary says are decided, because the comparison against Control lives on that endpoint alone.

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
| `DASHBOARD_DETAIL` | no | `decided` | Which tests get a full snapshot read: `decided` (outcome `winner` or `loser`), `all`, or `none`. |
| `REQUEST_SPACING_MS` | no | `1100` | Delay before each snapshot read, to stay inside 60 reads per minute. |

The label is yours. It appears in the dashboard and in the logs. The script prints only the last 4 characters of a token, so a log you paste into a ticket does not leak one.

## Reading the walkthrough

### One token, one shop

A token is scoped to a single shop. There is no cross-store endpoint and no organization-level token. Holding 30 stores means holding 30 tokens and making 30 passes. Keep them in your secret manager and read them in at run time.

### The summary rides along with the list

`?include=results_summary` inlines a small fixed summary on each list row: `computed_at`, `outcome`, `winning_test_group_index`, `srm_status`, and per test group the sample size and the six metrics. It is `null` for a test with no snapshot yet.

What it deliberately leaves out is the comparison against Control. Lift, difference, intervals, and p-values live on `GET /v1/experiments/{id}/results` alone, so that a list page cannot be mistaken for a result you can act on. This dashboard honors that split: the summary fills the table, and the **Best test group** column fills in only for the rows whose snapshot it read.

`DASHBOARD_DETAIL` decides which rows those are. The default, `decided`, reads the snapshot for tests the platform already called a `winner` or a `loser` and leaves the rest with a summary row. `all` reads every one, `none` reads no snapshots at all.

### Pacing against the rate limit

Each token gets 60 reads per minute. A store with 12 active tests now costs one list read, not 25, because the summary comes inlined and the list pages 100 tests at a time. Only the snapshot reads are extra, and the script sleeps `REQUEST_SPACING_MS` before each of those.

`lib/abconvert.mjs` also honors `Retry-After` on a 429 and retries, so a burst recovers on its own. The spacing is there to keep you from spending the whole minute in the first two seconds and then waiting.

### One store failing does not sink the run

A revoked token, a shop with API access turned off, or a single test that 404s is recorded as an error row and the run continues. Both output files carry an **Errors** section, so a silent partial dashboard is not possible.

### Reading the output

- **Days** counts whole days since `started_at`. A long-running test with a `outcome` is the first thing to act on.
- **Visitors** sums `sample_size` across the test groups in the summary.
- **Result** shows the platform's `outcome`, unless `srm_status` is `mismatch`, in which case it shows the mismatch instead. A broken traffic split makes the outcome untrustworthy, so the dashboard leads with it.
- **Best test group** is the non-control test group whose `difference` on the test's `primary_metric` is largest, quoted with its interval. A lift whose interval spans zero is not a result yet, which is why the interval is on the same line. Rows whose snapshot this run did not read say so instead of showing a blank.

### Rank on the difference, not the lift

Every comparison carries `difference`, in the metric's own unit. `lift` is the same change as a percentage of Control, and it is null in two cases: Control's value is zero, or Control and the test group sit on opposite sides of zero. `profit_per_visitor` reaches the second one whenever costs cross revenue.

A dashboard that sorts on `lift` drops those rows silently, and they are the rows that moved most. So the script ranks on `difference` and prints the lift only where there is one:

```js
.map((group) => ({ rank: comparisonRank(comparison), summary: describeComparison(comparison, { metric }) }))
```

Money metrics carry `{amount, currency}` with as many decimal places as the measurement needs, so the script prints `amount` as sent rather than rounding it to cents.

## Ask Claude

> "Build me a table of every test running across all my stores, sorted by how long it has been running."

> "Across all my active tests, which one has the highest probability of beating Control on revenue per visitor?"

> "List every test that has been running longer than 21 days and tell me which ones have enough traffic to call."

## Common mistakes

- **Expecting one token to see several stores.** It cannot. Collect one token per store.
- **Acting on `results_summary` alone.** It carries no interval and no p-value on purpose. Read the snapshot before you call a result.
- **Firing all stores in parallel with no pacing.** You will spend the minute's read budget instantly and spend the rest of the run in backoff.
- **Ranking by lift alone.** It hides every test group whose lift is null, and it needs the interval beside it, or the dashboard will make a noisy 30% swing on 80 visitors look like the best result in the portfolio.
- **Committing the output.** `out/` holds store names and traffic figures. It is in `.gitignore` for a reason.
