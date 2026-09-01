# Slack test report

Post a day 7 and day 14 summary of every running test to a Slack channel, written by Claude.

## What it does

1. Lists every active test with `GET /v1/experiments?status=active`.
2. Keeps the ones whose `started_at` is exactly 7 or 14 whole days ago.
3. Reads `GET /v1/experiments/{id}/results?breakdown=date` for the numbers and the per-day trend. To group by any other dimension, use the [custom result query](https://docs.abconvert.io/api-reference/results/create-a-custom-result-query).
4. Sends the figures to Claude for a short, decision-first summary, then posts it to a Slack incoming webhook. The system prompt in `summarize()` pins down `srm_status`, `outcome`, intervals, and money formatting: read it before you change the model or the wording.

Run it once a day from your own scheduler: a cron entry, an n8n schedule trigger, or a GitHub Action. ABConvert does not call you when a test reaches day 7.

The mechanics — why the day mark is picked on `started_at` rather than `created_at`, where test group names live, formatting money objects, the `lift`-is-null fallback — are explained inline in [`report.mjs`](report.mjs), next to the code that handles each one.

## Setup

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."
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

## Ask Claude

Instead of scheduling the script, hand an agent the skill in [`skills/abconvert-public-api/`](../../skills/abconvert-public-api/) and ask:

> "Summarize the results of every test that hit day 7 or day 14 today, and post it to my Slack channel."

> "Show me the day-by-day breakdown for test 3021 and tell me whether the lift is stable or still moving."

> "Check test 3021 for a sample ratio mismatch and tell me whether the results are trustworthy."

## Common mistakes

- **Polling results on a tight loop.** The endpoint reads a stored snapshot and computes nothing. Reading it every minute burns your 60 reads per minute and returns the same `computed_at`.
- **Labeling test groups by index.** Index 1 is not always `Variant A`, and Control is not always index 0. Read `control` and `name` off the test.
- **Treating a 202 as an error.** It means the pipeline has not computed a snapshot for this test yet. `getResults` returns `null` for it, and the report says so instead of printing zeros. Retry after the next refresh.
- **Reporting a lift without its interval.** A +6.2% lift whose interval spans zero is not a result.
- **Interpolating a money metric into a string.** You get `[object Object]`. Format `{amount, currency}`, and keep every decimal place it came with.
