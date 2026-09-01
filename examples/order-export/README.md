# Order export

Start an async order export, poll the job until it finishes, download the CSV, and summarize it locally.

Use this when the results snapshot does not answer your question. The snapshot gives you visitors, orders, revenue, lift, and an outcome; the export gives you the individual orders, so you can slice them any way you like.

## What it does

1. `POST /v1/experiments/{id}/exports` with a `date_range`. The API answers 202 with a job.
2. `GET /v1/exports/{id}` on a loop until `status` is `completed` or `failed`. You run the loop. Nothing calls you back.
3. Downloads the signed `url` before `expires_at`.
4. Reads the test for its test group names, then parses the CSV and prints orders, revenue, and average order value per test group.

Read scope is enough to create an export. It still spends write budget on the rate limit. See [rate limits](https://docs.abconvert.io/api-reference/overview#rate-limits) and the [export reference](https://docs.abconvert.io/api-reference/exports/create-an-export-job).

[`export.mjs`](export.mjs) explains the mechanics inline, next to the code: the calendar-day date range, the derived idempotency key, the poll loop, and the beta column matching.

## Setup

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."     # read scope is enough
export EXPORT_EXPERIMENT_ID="3021"
node examples/order-export/export.mjs
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ABCONVERT_API_TOKEN` | yes | | Bearer token for one shop. Read scope is enough. |
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | You rarely need to set it. |
| `EXPORT_EXPERIMENT_ID` | yes | | The test's numeric ID as a string, for example `"3021"`. |
| `EXPORT_GTE` | no | 29 days ago | Start of the range, a calendar day (`2026-08-01`). Inclusive. |
| `EXPORT_LTE` | no | today | End of the range, a calendar day. Inclusive. |
| `EXPORT_SAMPLE_BASIS` | no | `assignment` | `assignment` counts every visitor put in a test group, `exposure` only those the test showed a change to. |
| `EXPORT_IDEMPOTENCY_KEY` | no | derived from the request | Supply your own when a queue owns the retry. |
| `EXPORT_OUT_DIR` | no | `./out` | Where the CSV lands. |
| `EXPORT_POLL_MS` | no | `5000` | Delay between polls. |
| `EXPORT_TIMEOUT_MS` | no | `600000` | Give up after 10 minutes and tell you to poll again later. |

## Common mistakes

- **Saving the download URL for later.** The URL is signed and expires after 7 days. After `expires_at` the job still reads `completed` with `url` null, so check `url`, not `status`.
- **Sending timestamps in `date_range`.** Both bounds are calendar days: `2026-07-01`, not `2026-07-01T00:00:00Z`.
- **Reusing an idempotency key with a different date range.** That returns 409 `idempotency_key_in_use`. One key per distinct request.
- **Reading the `Test Group` column as a name.** It carries the test group's index (`0`, `1`, `2`). Names live on the test, so resolve them from `test_groups[index].name` before showing a row to anyone. This script does that with one extra read.
- **Assuming the column names are stable.** The schema is in beta, so the script matches each column it needs against a list of likely names (`COLUMN_CANDIDATES`). When it cannot find one, it prints the header row it got and names the missing field. Add the real name to the list and run it again.
- **Expecting statistics in the CSV.** There is no lift, interval, or outcome in the file, because those need visitor denominators the orders do not carry. Read `GET /v1/experiments/{id}/results` for the statistics.
