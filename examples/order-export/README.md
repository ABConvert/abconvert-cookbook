# Order export

Start an async order export, poll the job until it finishes, download the CSV, and run a local analysis on it.

Use this when the results snapshot does not answer your question. The snapshot gives you visitors, orders, revenue, lift, and a verdict. The export gives you the individual orders, so you can slice them any way you like.

> **The API is not live yet.** `api.abconvert.io` starts accepting requests when the API ships, so you cannot run this against production today. The script matches the published contract and will be verified against a dev store before general availability.

## What it does

1. `POST /v1/experiments/{id}/exports` with a `date_range`. The API answers 202 with a job.
2. `GET /v1/exports/{id}` on a loop until `status` is `completed` or `failed`.
3. Downloads the signed `url` before `expires_at`.
4. Parses the CSV and prints orders, revenue, and average order value per test group.

You run the polling loop. The API does not call you when the job finishes, and webhook triggers are not available yet.

**This one needs a write token.** Starting an export is a write. Polling the job is a read.

## Setup

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."     # write scope
export EXPORT_EXPERIMENT_ID="3021"
node examples/order-export/export.mjs
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ABCONVERT_API_TOKEN` | yes | | Bearer token for one shop, write scope. |
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | Override for a dev backend. |
| `EXPORT_EXPERIMENT_ID` | yes | | The test's numeric ID as a string, for example `"3021"`. |
| `EXPORT_GTE` | no | 30 days ago | Start of the range, ISO 8601. Inclusive. |
| `EXPORT_LTE` | no | now | End of the range, ISO 8601. Inclusive. |
| `EXPORT_OUT_DIR` | no | `./out` | Where the CSV lands. |
| `EXPORT_POLL_MS` | no | `5000` | Delay between polls. |
| `EXPORT_TIMEOUT_MS` | no | `600000` | Give up after 10 minutes and tell you to poll again later. |

## Reading the walkthrough

### The request takes a date range and nothing else

The export body is one field:

```json
{ "date_range": { "gte": "2026-07-01T00:00:00Z", "lte": "2026-07-31T23:59:59Z" } }
```

Both bounds are required and both are inclusive. The export is in beta and takes no other filters yet, matching the ABConvert admin's own order export.

### The idempotency key

`POST /v1/experiments/{id}/exports` accepts an `Idempotency-Key` header. Replaying a request with the same key returns the original response instead of starting a second job. Reusing a key with a different body returns 409 `idempotency_key_in_use`.

The script generates one key per run. If you build a retry queue, store the key with the queued job so the retry carries the same one, or you will pay for the same export twice.

### Polling

The job moves through `pending`, `processing`, and then `completed` or `failed`. The script polls every 5 seconds and gives up after 10 minutes with a message rather than looping forever. On `failed`, read `failure_reason`.

### The download link expires

When `status` is `completed`, `url` holds a signed link that works until `expires_at`. Download it in the same run. A link stashed in a queue and fetched an hour later may be dead.

### The row cap

`truncated: true` means the export hit the row cap, currently 10,000 rows. The file you get is real but partial. Narrow the date range and export again for the rest. The script warns rather than analyzing a partial file silently.

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

The output is raw order figures per test group: order count, revenue, average order value. There is no lift, no interval, and no verdict in it, because the API computes those from visitor denominators the order export does not carry. Read `GET /v1/experiments/{id}/results` for the statistics, and use the export for the questions the snapshot cannot answer, such as how the change moved a specific product or a specific customer segment.

## Ask Claude

> "Export the order-level data for test 3021 for the last 30 days, download it, and tell me how average order value differs between the test groups."

> "Pull the order export for test 3021 for July and tell me whether the lift is coming from one product or spread across the catalog."

> "My export came back truncated. Split the range and pull the whole month."

## Common mistakes

- **Polling with a read-only token.** Starting the export needs write. Polling does not. A read token fails on the first call.
- **Saving the download URL for later.** It is signed and expires.
- **Analyzing a truncated file.** Check `truncated` before you draw a conclusion from the numbers.
- **Reusing an idempotency key with a different date range.** That returns 409 `idempotency_key_in_use`. One key per distinct request.
- **Expecting statistics in the CSV.** Lift and significance come from the results endpoint.
