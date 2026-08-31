# Slack test report

Post a day 7 and day 14 summary of every running test to a Slack channel, written by Claude.

## What it does

1. Lists every active test with `GET /v1/experiments?status=active`. Each list row carries the test group names.
2. Keeps the ones whose `started_at` is exactly 7 or 14 whole days ago.
3. Reads `GET /v1/experiments/{id}/results?breakdown=date` for the numbers and the per-day trend.
4. Sends the figures to Claude for a short, decision-first summary.
5. Posts the summary to a Slack incoming webhook.

You run it. Point a daily cron entry, an n8n schedule trigger, or a GitHub Action at it. ABConvert does not call you when a test reaches day 7, and webhook triggers are not available yet.

## Setup

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."     # read scope is enough
export ANTHROPIC_API_KEY="sk-ant-..."
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
node examples/slack-report/report.mjs
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ABCONVERT_API_TOKEN` | yes | | Bearer token for one shop. Read scope is enough. |
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | Override for a dev backend. |
| `ANTHROPIC_API_KEY` | unless `SKIP_LLM=1` | | Claude API key. |
| `SLACK_WEBHOOK_URL` | unless `DRY_RUN=1` | | Slack incoming webhook. |
| `REPORT_DAY_MARKS` | no | `7,14` | Which day marks to report on. |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5` | Model used for the summary. |
| `DRY_RUN` | no | | `1` prints the message instead of posting it. |
| `SKIP_LLM` | no | | `1` posts the raw figures with no summary. |

Start with `DRY_RUN=1 SKIP_LLM=1` to see exactly what the API returned before you wire in either service.

## Reading the walkthrough

### Finding the tests that are due

The list endpoint filters on `created_at`, not on `started_at`. A test drafted in March and launched in June has a `created_at` months before the day you care about, so the script filters on `started_at` in memory:

```js
const active = await abconvert.listAllExperiments({ status: "active" });
const due = active.filter((e) => DAY_MARKS.includes(daysRunning(e.started_at)));
```

`listAllExperiments` walks the cursor for you. Lists come back as `{object: "list", data, has_more, next_cursor}`, and you pass `next_cursor` back as `?cursor=`.

A day mark is one calendar day wide, so run this once a day. A run that is skipped entirely skips that day's marks with it: if the job did not run, no report goes out for the tests that hit day 7 that day.

### Group names live on the test, not on the snapshot

The results snapshot identifies each row by `test_group_index` and nothing else. Names, and which group is Control, live on the test, and the list rows already carry them: each row's `test_groups` holds `name`, `control`, and `split`. So the script reads the names off the list row it already has and fetches only the snapshot.

Merchants rename test groups, so never label a row `Variant A` because its index is 1. Read the name off `test_groups[index].name`.

### A 202 means no snapshot yet

`GET /v1/experiments/{id}/results` answers 202 with no body when the analytics pipeline has not computed a snapshot. The client returns `null` for that case, and the report says so rather than printing zeros. Polling faster than the pipeline refreshes returns the same snapshot with an unchanged `computed_at`.

### `breakdown=date`

`date` is the only breakdown the snapshot read offers; for anything else, `POST /v1/experiments/{id}/results` runs a custom result query that groups by any of 15 dimensions (country, device, UTM fields, and more). Here, `breakdown=date` adds a `breakdown.rows` array alongside the overall totals, one row per test group per day, each carrying the same fields as an overall row plus `dimension_value`. The script prints the last five days so the summary can say whether a lift is stable or still moving.

### Money, and the lift that is not there

Two shapes in the snapshot need handling before the numbers reach Slack, and the script does both in `lib/abconvert.mjs`:

- **Money metrics are objects.** `revenue_per_visitor`, `average_order_value`, `profit_per_visitor`, and `revenue` come back as `{"amount": "3.87", "currency": "USD"}`. Dropping one into a template string prints `[object Object]`. `amount` carries as many decimal places as the measurement needs, so a `risk` of `"0.004"` is real: print it as sent, never rounded to cents.
- **`lift` is null when no percentage exists.** Control's value is zero, or Control and the test group sit on opposite sides of zero, which `profit_per_visitor` reaches whenever costs cross revenue. `confidence_interval` and `credible_interval` are null there too. `describeComparison` quotes the lift and its interval where there is one, and falls back to `difference` with `frequentist.difference_interval` where there is not, so a real result never prints as `n/a`.

### What the summary is told

The system prompt pins down the parts that matter and are easy to get wrong:

- Check `srm_status` first. `mismatch` means the traffic split is broken, so the numbers are not trustworthy.
- Report `outcome` as the platform's call. Do not re-derive it from the p-value.
- Quote every figure with its interval, never a bare point estimate.
- Repeat an absolute difference as an absolute difference. Do not invent a percentage for a comparison that has none.
- Repeat money as written. Do not round it.
- On `insufficient_data`, say the test needs more traffic instead of extrapolating.

`profit_per_visitor` reads `null` until COGS settings are configured. Omit it rather than reporting 0.

## Ask Claude

Instead of scheduling the script, hand an agent the skill in [`skills/abconvert-public-api/`](../../skills/abconvert-public-api/) and ask:

> "Summarize the results of every test that hit day 7 or day 14 today, and post it to my Slack channel."

> "Show me the day-by-day breakdown for test 3021 and tell me whether the lift is stable or still moving."

> "Check test 3021 for a sample ratio mismatch and tell me whether the results are trustworthy."

## Common mistakes

- **Polling results on a tight loop.** The endpoint reads a stored snapshot and computes nothing. Reading it every minute burns your 60 reads per minute and returns the same `computed_at`.
- **Labeling groups by index.** Index 1 is not always `Variant A`, and Control is not always index 0. Read `control` and `name` off the test.
- **Treating a 202 as an error.** It means the pipeline has not run for this test yet. Retry after the next refresh.
- **Reporting a lift without its interval.** A +6.2% lift whose interval spans zero is not a result.
- **Interpolating a money metric into a string.** You get `[object Object]`. Format `{amount, currency}`, and keep every decimal place it came with.
