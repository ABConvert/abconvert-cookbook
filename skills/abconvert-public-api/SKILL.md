---
name: abconvert-public-api
description: Manage ABConvert tests through the public REST API (/v1) - create, preview, launch, pause, end, and read results - and analyze the results. Use when the user wants to drive tests via the API, demo the public API, or asks to create/launch/analyze a test programmatically instead of through the ABConvert admin.
---

# ABConvert Public API

Drive A/B tests on a Shopify store over REST: create a draft, preview it, launch it, read its results.

The full contract is the API reference at https://docs.abconvert.io/api-reference/overview. This file is the operating summary. Runnable examples for reporting, guardrails, portfolio dashboards, and order exports live in the ABConvert cookbook repository.

## Inputs (collect before doing anything)

1. **Base URL.** Read it from `ABCONVERT_API_BASE` when the user has set one. Otherwise use the default, `https://api.abconvert.io/v1`.
2. **API token.** From `ABCONVERT_API_TOKEN` or from the user. Never print a full token; show the last 4 characters only.
3. **Which shop.** A token is scoped to exactly one shop. Multi-store work needs one token per store.

If any input is missing, stop and ask. Do not guess a base URL, and do not try to mint a token.

To get a token: ABConvert admin, **Settings > MCP & API Access**, then create. The plaintext is shown once.

## Scopes and account state

| Scope | Grants |
|---|---|
| `read_experiments` | List and retrieve tests, read results, and create, poll, and download exports |
| `write_experiments` | Everything read grants, plus create, update, lifecycle actions, schedule changes |

`GET` needs read. Everything else needs write, except `POST /v1/experiments/{id}/results` and `POST /v1/experiments/{id}/exports`, which read data and change nothing about the test (exports still spend write budget on the rate limit). Write implies read. New tokens default to read, so a 403 `insufficient_scope` on a create usually means the user minted a read token.

A 403 `api_access_disabled` means API access is turned off for the shop. It can occur on any request, and it is an account state, not something to retry.

## Request conventions

- `Authorization: Bearer <token>`; JSON in, JSON out.
- IDs: a test uses its numeric admin ID **as a string** (`"3021"`). Shopify objects use full GIDs (`gid://shopify/Product/8123456789`). Export job IDs are opaque strings.
- Money is `{"amount": "17.99", "currency": "USD"}`, a decimal string in the shop's own currency. Anything else returns 422 `currency_mismatch`.
- `split` runs 0 to 100; `traffic_allocation` runs 1 to 100.
- Percentage adjustments are signed: `-10` lowers prices by 10%.
- `PATCH` is sparse: only the fields you send change. Lists whose entries carry an identifier merge by it: `prices` by `product_variant_id`, `test_groups` by `index`, `country_prices` by `country`, redirect `destinations` by `rule_key`. Delete one price entry with `"remove": true`.
- Lists are cursor-paginated: `{object: "list", data, has_more, next_cursor}`; pass `next_cursor` as `?cursor=`. `limit` is 1 to 100, default 20.
- Send an `Idempotency-Key` header (a fresh UUID per request) on `POST /v1/experiments` and `POST /v1/experiments/{id}/exports`, so a retry never creates a duplicate. Reusing a key with a different body returns 409 `idempotency_key_in_use`. A key outside 1 to 255 characters returns 400 `invalid_idempotency_key` rather than being ignored.
- `?include=results_summary` on the list and retrieve endpoints inlines a small fixed results summary. Any other value returns 400 `invalid_include`.
- Rate limits per token: 60 reads and 10 writes per minute. Responses counted against a budget carry `X-RateLimit-*` headers; a 429 carries `Retry-After` in seconds. Honor it, and never busy-loop writes. `POST /v1/experiments/{id}/results` is a read that a read token may call, but it draws on its own budget of 10 result queries per minute.
- Timestamps are ISO 8601 in fields suffixed `_at`. The exceptions are comparison keys inside a range object: `date_range.gte`, `created_at[lte]`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/experiments` | List. Filters: `status`, `type`, `created_at[gte]`, `created_at[lte]`, `scheduled`. Archived tests appear only with `status=archived`. List rows omit `changes`. Add `include=results_summary` to inline each test's results summary. |
| POST | `/v1/experiments` | Create. Always lands in `draft`. |
| GET | `/v1/experiments/{id}` | Retrieve, with full `changes`. Takes `include` and nothing else. |
| PATCH | `/v1/experiments/{id}` | Sparse update. |
| POST | `/v1/experiments/{id}/preview` | `draft` to `preview`; returns `test_group_preview_urls`, one per test group. Optional body `{"resource": "<product-handle>"}` picks the product a price test's preview URLs open on; other types ignore it and preview on the home page. |
| POST | `/v1/experiments/{id}/start` | Launch from `draft` or `preview`. Runs launch guards. |
| POST | `/v1/experiments/{id}/revert_to_draft` | `preview` back to `draft`. No other status can revert. |
| POST | `/v1/experiments/{id}/pause` and `/resume` | Pause or resume. |
| POST | `/v1/experiments/{id}/end` | `active` or `paused` to `ended`. **One way.** |
| POST | `/v1/experiments/{id}/archive` | Archive `draft`, `preview`, `ended`, or `failed`. **One way, no unarchive.** |
| PUT and DELETE | `/v1/experiments/{id}/schedule` | Set or clear `{start_at, end_at}`. After launch only `end_at` is editable. |
| GET | `/v1/experiments/{id}/results` | Latest results snapshot (beta). 202 until the first snapshot. Optional `breakdown=date`. |
| POST | `/v1/experiments/{id}/results` | Custom result query (beta): group by one or two dimensions, narrow the window, scope to a product group. Answers 200 when a computed snapshot already covers it, 202 while one computes. |
| GET | `/v1/experiments/{id}/results/{query_id}` | Poll a custom result query. Rows carry values with no comparison against Control. |
| POST | `/v1/experiments/{id}/exports` | Start an async order export for a `date_range`, optionally a `sample_basis`. Answers 202 with a job. |
| GET | `/v1/exports/{id}` | Poll the export job. When `status` is `completed` and `expires_at` is in the future, `url` holds the signed download link; it goes null once the link expires. Branch on `url`, not `status`. |
| GET | `/v1/exports/{id}/download` | Download the CSV. Takes no bearer token: the signed `url` from the job is the credential. Fetch it as given. |

Statuses: `draft`, `preview`, `active`, `paused`, `ended`, `failed`, `archived`. Scheduling is not a status: a scheduled test is a `draft` or `preview` carrying a `schedule`.

`visual_editor` and `combined` tests are read and lifecycle only over the API; creating or changing one returns 501 `not_implemented`. Checkout block customizations and offer widgets are authored in the admin too, and read back read-only.

**When the user asks for a preview, the deliverable is the `test_group_preview_urls`, one clickable link per test group.** Each link uses the shop's preview key to assign the visitor to that test group. `template_preview_url` on a test group (template tests only) is not a preview: it renders the template with no test assignment. Use it only as a secondary check that the template renders.

The link carries the assignment for the whole visit, so after opening it, navigate to the page that shows the change (for example `/products/<handle>`).

## Creating a test

Required: `type`, `name`, `test_groups` (2 to 5, each with `split` and `changes`; splits sum to 100; exactly one `"control": true`). Optional: `hypothesis`, `primary_metric`, `traffic_allocation`, `shared`, `schedule`, `audience`. Send the one `shared` key matching the type.

Creatable types: `price`, `shipping`, `theme`, `template`, `url_redirect`, `checkout`, `offer`.

Minimal price test, percentage adjustment form:

```json
{
  "type": "price",
  "name": "PDP -10% price test",
  "hypothesis": "A 10% lower price lifts conversion enough to raise revenue per visitor.",
  "primary_metric": "revenue_per_visitor",
  "shared": { "price": { "product_ids": ["gid://shopify/Product/8123456789"] } },
  "test_groups": [
    { "control": true, "split": 50, "changes": [] },
    { "split": 50, "changes": [
      { "type": "price", "adjustment": { "unit": "percentage", "value": -10 } }
    ] }
  ]
}
```

Per-type traps, each of which returns a 422 with a named finding:

- **price**: `prices[]` entries key on `product_variant_id`; sending `adjustment` recalculates every price not sent in the same request. Pricing across more than one market needs the Scale plan or higher. At most 500 products, and 100 on most shops.
- **shipping**: Control must send `changes: []` (`control_offers_rates`); a rate without `shopify_rate_id` is a new rate and needs `name` and `price`.
- **template**: Control must **also** carry a `template_key` change. `changes: []` returns `template_required`.
- **theme**: Control may send `changes: []`; it resolves to the main theme.
- **url_redirect**: every `shared.url_redirect.rules[].key` needs a matching `destinations[].rule_key` in each variant. Writes accept `subject: path` and `match_type` of `exact`, `starts_with`, or `contains` only.
- **offer**: exactly one discount per test group in v1; `has_widgets` is read-only.

## Lifecycle rules

- Repeating an action that already holds (`start` on `active`, `pause` on `paused`) is a no-op 200, not an error. Safe to retry.
- An illegal transition returns 409 `invalid_status_transition`, and `details.allowed_actions` names what is legal. Relay that instead of guessing.
- 409 `checks_pending` means platform checks such as theme validation are still running; the response's `details.allowed_actions` lists what works meanwhile (typically `archive`). Poll `GET /v1/experiments/{id}` until the status settles, then retry.
- After launch only `name`, `hypothesis`, `primary_metric`, each test group's `name` and `split`, and `schedule.end_at` are writable. Anything else returns 409 `locked_field`. Sending a locked field with its current value is safe.
- Changing a `split` returns a new `assignment_version` and the `split_changed` warning. Visitors already in the test keep their test group, so the traffic already recorded still reflects the old split. Warn the user that it dilutes accumulated data before doing it.
- Feature checks run on create, `PATCH`, `preview`, `start`, and `resume`; a lapsed subscription or reached cap blocks only `start` and `resume`. `pause`, `end`, and `archive` never run either check, so the user always keeps control of a live test.

**Ask before irreversible or traffic-affecting actions.** `start` puts real visitors into the test; `end` and `archive` cannot be undone. Never chain create to start in one step unless the user asked to launch. Prefer create, then `preview`, then share the preview URLs, then let the user confirm, then `start`.

## Reading results

`GET /v1/experiments/{id}/results`. A 202 means the pipeline has not computed a snapshot yet. Tell the user to check back; do not poll in a tight loop. Polling faster than the pipeline refreshes returns the same snapshot with an unchanged `computed_at`.

The snapshot carries `outcome`, `winning_test_group_index`, `srm_status`, `analysis` (`credible_interval_level`, `confidence_level`), and one row per test group with `test_group_index`, `sample_size` (the visitor denominator), `session_count` (the denominator for `add_to_cart_rate` and `reached_checkout_rate`), the six metrics, `orders`, `revenue`, and `vs_control` (null on the control row) with `lift`, `difference`, `bayesian` (`prob_beat_control`, `credible_interval`, `risk`, any of which may be null, and the whole object null where Bayesian analysis is unavailable), and `frequentist` (`p_value`, `confidence_interval`, `difference_interval`).

Every metric field is nullable. Guard each one you read.

`breakdown=date` adds `breakdown.rows`, one row per test group per day, each with the same fields plus `dimension_value`. Breakdown rows carry no `frequentist` comparison; read intervals from the overall rows.

**The snapshot has no test group names.** Rows are identified by `test_group_index` only. Fetch `GET /v1/experiments/{id}` for `test_groups[].name` and `control`. Merchants rename their test groups, so never label a row from its index.

### `difference` and `lift`

`difference` is the absolute change from Control in the metric's own unit, null only when Control or the test group has no value for the metric at all. `lift` is that same change as a fraction of the **magnitude** of Control's value (`0.062` is +6.2%), so it stays positive for a test group that improves on a negative Control.

**`lift` is null in two cases where `difference` still holds a value.** Control's value is zero, or Control and this test group sit on strictly opposite sides of zero. The second case is real, not theoretical: `profit_per_visitor` goes negative when COGS and ad cost exceed revenue, so a test group crossing from loss to profit has no statable percentage. `frequentist.confidence_interval` and `bayesian.credible_interval` bound `lift`, so both are null wherever it is.

**Read `difference` for direction and size. Quote `lift` only when it is non-null.** Where `lift` is null, quote `difference` with `frequentist.difference_interval`, which is in the metric's own unit and stays populated: "profit per visitor +$0.41 (95% CI -$0.06 to +$0.88)". Rank test groups on `difference` too: sorting on `lift` silently drops the test group that crossed zero, which is the one that moved most.

### Money fields

`revenue_per_visitor`, `average_order_value`, `profit_per_visitor`, and `revenue` are the `Money` object `{"amount": "3.87", "currency": "USD"}`, not bare numbers. So are `difference`, both `difference_interval` bounds, and `bayesian.risk` on those metrics, each in its own metric's unit. The rates stay bare numbers throughout, and which metrics are money is fixed by the contract, so you can rely on it per field.

**`amount` is a decimal string carrying at least the currency's minor units, and more where the value needs them.** These are measurements, not prices: a sub-cent `risk` publishes as `"0.004"`. Parse it as a decimal and never assume two places. Rounding to cents turns a real finding into `0.00`.

When summarizing results:

1. **Check `srm_status` first.** `mismatch` means the traffic split is broken and the results are not trustworthy. Say so prominently and stop short of a recommendation.
2. Report the `outcome` (`winner`, `loser`, `inconclusive`, `insufficient_data`) as the platform's call. Do not override it with your own reading of the p-value.
3. Never quote a bare point estimate. Pair it with its interval: `confidence_interval` when quoting a lift, `difference_interval` when quoting a difference.
4. On `insufficient_data` or a tiny `sample_size`, say the test needs more traffic. Do not extrapolate.
5. `profit_per_visitor` is null until COGS settings are configured. Omit it rather than reporting 0. Once configured it can legitimately be negative, and that is a real loss, not a bug.

## Order exports

`POST /v1/experiments/{id}/exports` with `{"date_range": {"gte": "2026-08-01", "lte": "2026-08-15"}}`. Both bounds are required and inclusive, and both are calendar days in the store's timezone, not timestamps. Optional `sample_basis` (`assignment` by default, or `exposure`) picks the denominator. `exposure` is only available on tests that measure exposure; others return 422 `sample_basis_unsupported`. The API answers 202 with a job; poll `GET /v1/exports/{id}` until `status` is `completed` or `failed`.

The window narrows to the days that can hold data: no earlier than the day the test started, no later than today. A window that can hold nothing returns 422 `date_range_out_of_bounds`. A test that has not started returns 422 `export_not_available`.

On `completed`, `url` is a signed link valid until `expires_at`. Download it in the same run. The export is not capped, so a wide range returns every attributed order.

The column schema matches the admin's order export and is in beta. Read the header row rather than assuming column names. The export is cut the way the analytics dashboard cuts its numbers, outlier filter included, so the two reconcile.

## Error handling (surface, do not swallow)

Every error has one shape: `{"error": {"type", "code", "message", "param", "details", "findings"}}`.

- **Relay `error.message` and `error.code` verbatim.** Messages are written to be actionable ("This token was revoked. Create a new one in Settings.").
- **422 validation**: `findings[]` lists every violation with a JSON-path `param`. Report all of them at once, fix the payload, retry once. Do not fix one finding at a time.
- **Success responses can carry a top-level `warnings` array** (non-blocking findings such as `split_changed` or `country_served_by_other_market`). Always show these. A 2xx with warnings is not a clean pass.
- **403 family**: `insufficient_scope`, `api_access_disabled`, `feature_not_in_plan` (`param` names the feature: `price`, `offer`, `multi_market`, or `checkout_blocks`), `subscription_inactive`, `billing_cap_reached`, `carrier_service_required`. These are account states. Explain the fix; do not retry.
- **401 family**: `missing_token`, `invalid_token`, `token_revoked`.
- **Launch guards**: `start` can return 422 on cross-test conflicts. A running theme test blocks shipping, template, and URL redirect launches, combined tests carrying one of those changes, and a second theme test (`theme_test_running`); price, offer, and checkout tests can launch alongside it. Products claimed by a running price test and delivery zones claimed by a running shipping test both return the finding `resource_claimed`, which names the test holding the claim; relay that name. Products and zones are claimed only while a test is `active`; theme conflicts also come from tests in `preview`, so check `status=preview` too.
- Launch can return the finding `app_embed_disabled` when the storefront app embed is off; when in doubt, ask the user to check the embed in the ABConvert admin before launching.
- 5xx `internal_error`: retry once with backoff, then report.
