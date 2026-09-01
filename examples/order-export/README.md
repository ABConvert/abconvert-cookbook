# Order export

Start an async order export, poll the job until it finishes, download the CSV, and summarize it locally.

Use this when the results snapshot does not answer your question. The snapshot gives you visitors, orders, revenue, lift, and an outcome; the export gives you the individual orders, so you can slice them any way you like.

## What it does

1. `POST /v1/experiments/{id}/exports` with a `date_range`. The API answers 202 with a job.
2. `GET /v1/exports/{id}` on a loop until `status` is `completed` or `failed`. You run the loop; nothing calls you back.
3. Downloads the signed `url` before `expires_at`.
4. Reads the test for its test group names, then parses the CSV and prints orders, revenue, and average order value per test group.

Read scope is enough to create an export. It still spends write budget on the rate limit. See [rate limits](https://docs.abconvert.io/api-reference/overview#rate-limits) and the [export reference](https://docs.abconvert.io/api-reference/exports/create-an-export-job).

## Setup

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."     # read scope is enough
export EXPORT_EXPERIMENT_ID="3021"
node examples/order-export/export.mjs
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ABCONVERT_API_TOKEN` | yes | | Bearer token for one shop. Read scope is enough. |
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | Override for a dev backend. |
| `EXPORT_EXPERIMENT_ID` | yes | | The test's numeric ID as a string, for example `"3021"`. |
| `EXPORT_GTE` | no | 29 days ago | Start of the range, a calendar day (`2026-08-01`). Inclusive. |
| `EXPORT_LTE` | no | today | End of the range, a calendar day. Inclusive. |
| `EXPORT_SAMPLE_BASIS` | no | `assignment` | `assignment` counts every visitor put in a test group, `exposure` only those the test showed a change to. |
| `EXPORT_IDEMPOTENCY_KEY` | no | derived from the request | Supply your own when a queue owns the retry. |
| `EXPORT_OUT_DIR` | no | `./out` | Where the CSV lands. |
| `EXPORT_POLL_MS` | no | `5000` | Delay between polls. |
| `EXPORT_TIMEOUT_MS` | no | `600000` | Give up after 10 minutes and tell you to poll again later. |

## Reading the walkthrough

### The date range

Both bounds are required, inclusive, and **calendar days in your store's timezone**, not timestamps: `2026-07-01T00:00:00Z` is rejected. The window narrows to the days that can hold data, no earlier than the day the test started and no later than today, so asking for more is not an error and changes no number. A window that can hold nothing returns 422 `date_range_out_of_bounds`, and a test that has not started returns 422 `export_not_available`. There is no row cap, so size the range for a file you want to download and parse.

### The idempotency key

`POST /v1/experiments/{id}/exports` accepts an `Idempotency-Key` header. Replaying a request with the same key returns the original response instead of starting a second job; reusing a key with a different body returns 409 `idempotency_key_in_use`, and a key outside 1 to 255 characters returns 400 `invalid_idempotency_key`. The script derives the key from the request, so a rerun of the same export reattaches to the original job while a different range gets its own. Set `EXPORT_IDEMPOTENCY_KEY` when a retry queue owns the key instead.

### Polling and downloading

The job moves through `pending`, `processing`, and then `completed` or `failed`. The script polls every 5 seconds and gives up after 10 minutes rather than looping forever. On `failed`, read `failure_reason`. On `completed`, `url` holds a signed link that works until `expires_at`, 7 days out; after that the job stays `completed` and `url` goes null, so branch on `url`, not on `status`.

### What the analysis is and is not

The output is raw order figures per test group: order count, revenue, average order value. There is no lift, no interval, and no outcome, because those need visitor denominators the order export does not carry. Read `GET /v1/experiments/{id}/results` for the statistics, and use the export for what the snapshot cannot answer, such as whether a change moved one product or the whole catalog.

## Ask Claude

> "Export the order-level data for test 3021 for the last 30 days, download it, and tell me how average order value differs between the test groups."

> "Pull the order export for test 3021 for July and tell me whether the lift is coming from one product or spread across the catalog."

> "Start an exposure-basis export for test 3021 for last month and tell me when it is ready."

## Common mistakes

- **Saving the download URL for later.** It is signed and expires.
- **Sending timestamps in `date_range`.** Both bounds are calendar days: `2026-07-01`, not `2026-07-01T00:00:00Z`.
- **Reusing an idempotency key with a different date range.** That returns 409 `idempotency_key_in_use`. One key per distinct request.
- **Reading the `Test Group` column as a name.** It carries the test group's index (`0`, `1`, `2`). Names live on the test, so resolve them from `test_groups[index].name` before showing a row to anyone. This script does that with one extra read.
- **Assuming the column names are stable.** The schema is in beta, so the script matches each column it needs against a list of likely names (`COLUMN_CANDIDATES`). When it cannot find one, it prints the header row it got and names the missing field. Add the real name to the list and run it again.
- **Expecting statistics in the CSV.** Lift and significance come from the results endpoint.
