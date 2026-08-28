# Order export

Start an async order export, poll the job until it finishes, download the CSV, and run a local analysis on it.

Use this when the results snapshot does not answer your question. The snapshot gives you visitors, orders, revenue, lift, and an outcome. The export gives you the individual orders, so you can slice them any way you like.

## What it does

1. `POST /v1/experiments/{id}/exports` with a `date_range`. The API answers 202 with a job.
2. `GET /v1/exports/{id}` on a loop until `status` is `completed` or `failed`.
3. Downloads the signed `url` before `expires_at`.
4. Parses the CSV and prints orders, revenue, and average order value per test group.

You run the polling loop. The API does not call you when the job finishes, and webhook triggers are not available yet.

Read scope is enough: an export downloads data and changes nothing about the test. It does spend write budget on the rate limit, because it exports order-level data in bulk.

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
| `EXPORT_SAMPLE_BASIS` | no | `assignment` | `assignment` counts every visitor put in a test group, `exposure` only those the test reached. |
| `EXPORT_IDEMPOTENCY_KEY` | no | derived from the request | Supply your own when a queue owns the retry. |
| `EXPORT_OUT_DIR` | no | `./out` | Where the CSV lands. |
| `EXPORT_POLL_MS` | no | `5000` | Delay between polls. |
| `EXPORT_TIMEOUT_MS` | no | `600000` | Give up after 10 minutes and tell you to poll again later. |

## Reading the walkthrough

### The request takes a date range and a sample basis

```json
{ "date_range": { "gte": "2026-07-01", "lte": "2026-07-31" }, "sample_basis": "assignment" }
```

Both bounds are required and inclusive, and both are **calendar days in your store's timezone**, not timestamps. A `2026-07-01T00:00:00Z` in either bound is rejected.

The window narrows to the days that can hold data: no earlier than the day the test started, no later than today. Asking for more than that is not an error and changes no number. A window that can hold nothing at all returns 422 `date_range_out_of_bounds`, and a test that has not started yet returns 422 `export_not_available`.

`sample_basis` picks the denominator, the same one the analytics dashboard offers. It is the export's only other filter today.

### The idempotency key

`POST /v1/experiments/{id}/exports` accepts an `Idempotency-Key` header. Replaying a request with the same key returns the original response instead of starting a second job. Reusing a key with a different body returns 409 `idempotency_key_in_use`, and a key outside 1 to 255 characters returns 400 `invalid_idempotency_key` rather than being ignored.

The script derives the key from the request itself, so a rerun of the same export reattaches to the original job while a different range gets its own key. Set `EXPORT_IDEMPOTENCY_KEY` when a retry queue owns the key instead.

### Polling

The job moves through `pending`, `processing`, and then `completed` or `failed`. The script polls every 5 seconds and gives up after 10 minutes with a message rather than looping forever. On `failed`, read `failure_reason`.

### The download link expires

When `status` is `completed`, `url` holds a signed link that works until `expires_at`. Download it in the same run. A link stashed in a queue and fetched an hour later may be dead.

### There is no row cap

The export is not capped, so a wide date range returns every attributed order. Size the range for the file you want to download and parse, not to dodge a limit.

### The column schema is in beta

The export carries the same columns as the ABConvert admin's order export, and that schema is in beta. Rather than hard coding column names that may move, the script matches them case insensitively against a candidate list:

```js
const COLUMN_CANDIDATES = {
  testGroup: ["test_group", "test group", "variant", "variation", "group", ...],
  orderTotal: ["total", "order_total", "total_price", "revenue", ...],
};
```

When it cannot find a column, it prints the header row it actually got and tells you which field is missing, instead of reporting zeros. Add the real name to the list and run it again.

### What the analysis is and is not

The output is raw order figures per test group: order count, revenue, average order value. There is no lift, no interval, and no outcome in it, because the API computes those from visitor denominators the order export does not carry. Read `GET /v1/experiments/{id}/results` for the statistics, and use the export for the questions the snapshot cannot answer, such as how the change moved a specific product or a specific customer segment.

## Ask Claude

> "Export the order-level data for test 3021 for the last 30 days, download it, and tell me how average order value differs between the test groups."

> "Pull the order export for test 3021 for July and tell me whether the lift is coming from one product or spread across the catalog."

> "Start an exposure-basis export for test 3021 for last month and tell me when it is ready."

## Common mistakes

- **Saving the download URL for later.** It is signed and expires.
- **Sending timestamps in `date_range`.** Both bounds are calendar days: `2026-07-01`, not `2026-07-01T00:00:00Z`.
- **Reusing an idempotency key with a different date range.** That returns 409 `idempotency_key_in_use`. One key per distinct request.
- **Expecting statistics in the CSV.** Lift and significance come from the results endpoint.
