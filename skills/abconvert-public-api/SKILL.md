---
name: abconvert-public-api
description: Manage ABConvert tests through the public REST API (/v1) - create, preview, launch, pause, end, and read results - and analyze the results. Use when the user wants to drive tests via the API, demo the public API, or asks to create/launch/analyze a test programmatically instead of through the ABConvert admin.
---

# ABConvert Public API

Drive A/B tests on a Shopify store over REST: create a draft, preview it, launch it, read its results.

The full contract is the ABConvert API reference and its `openapi.yaml`. This file is the operating summary. Runnable examples for reporting, guardrails, portfolio dashboards, and order exports live in the ABConvert cookbook repository.

**The API is not live yet.** `api.abconvert.io` starts accepting requests when the API ships. Until then, treat every call here as contract-accurate but unverified against production.

## Inputs (collect before doing anything)

1. **Base URL.** Production is `https://api.abconvert.io/v1`. Read it from `ABCONVERT_API_BASE` when the user has set one, for example a local backend.
2. **API token.** From `ABCONVERT_API_TOKEN` or from the user. New tokens start with `abcv_live_`; older `abc_` tokens still work and act as write tokens. Never print a full token; show the last 4 characters only.
3. **Which shop.** A token is scoped to exactly one shop. Multi-store work needs one token per store.

If any input is missing, stop and ask. Do not guess a base URL, and do not try to mint a token.

To get a token: ABConvert admin, then Settings, then API tokens, then create. The plaintext is shown once.

## Scopes and account state

| Scope | Grants |
|---|---|
| `read_experiments` | List and retrieve tests, read results, poll export jobs |
| `write_experiments` | Everything read grants, plus create, update, lifecycle actions, schedule changes, starting exports |

`GET` needs read. Everything else needs write. Write implies read. New tokens default to read, so a 403 `insufficient_scope` on a create usually means the user minted a read token.

A 403 `api_access_disabled` means API access is turned off for the shop. It can occur on any request, and it is an account state, not something to retry.

## Request conventions

- `Authorization: Bearer <token>`; JSON in, JSON out.
- IDs: a test uses its numeric admin ID **as a string** (`"3021"`). Shopify objects use full GIDs (`gid://shopify/Product/8123456789`). Export job IDs are opaque strings.
- Money is `{"amount": "17.99", "currency": "USD"}`, a decimal string in the shop's own currency. Anything else returns 422 `currency_mismatch`.
- `split` and `traffic_allocation` are integers 0 to 100. `traffic_allocation` starts at 1.
- Percentage adjustments are signed: `-10` lowers prices by 10%.
- `PATCH` is sparse: only the fields you send change. Keyed collections merge (`prices` on `product_variant_id`, `test_groups` on `index`, `country_prices` on `country`, redirect `destinations` on `rule_key`); delete one price entry with `"remove": true`.
- Lists are cursor-paginated: `{object: "list", data, has_more, next_cursor}`; pass `next_cursor` as `?cursor=`. `limit` is 1 to 100, default 20.
- Send an `Idempotency-Key` header on `POST /v1/experiments` and `POST .../exports` when retrying. Reusing a key with a different body returns 409 `idempotency_key_in_use`.
- Rate limits per token: 60 reads and 10 writes per minute. Every response carries `X-RateLimit-*`; a 429 carries `Retry-After` in seconds. Honor it, and never busy-loop writes.
- Timestamps are ISO 8601 in fields suffixed `_at`. The exceptions are comparison keys inside a range object: `date_range.gte`, `created_at[lte]`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/experiments` | List. Filters: `status`, `type`, `created_at[gte]`, `created_at[lte]`, `scheduled`. Archived tests appear only with `status=archived`. List rows omit `changes`. There is no `include` parameter and no results on the list. |
| POST | `/v1/experiments` | Create. Always lands in `draft`. |
| GET | `/v1/experiments/{id}` | Retrieve, with full `changes`. Rejects query parameters. |
| PATCH | `/v1/experiments/{id}` | Sparse update. |
| POST | `/v1/experiments/{id}/preview` | `draft` to `preview`; returns `test_group_preview_urls`, one per test group. Optional body `{"resource": "<storefront-handle>"}` picks the resource to preview on. |
| POST | `/v1/experiments/{id}/start` | Launch from `draft` or `preview`. Runs launch guards. |
| POST | `/v1/experiments/{id}/revert_to_draft` | `preview` back to `draft`. No other status can revert. |
| POST | `/v1/experiments/{id}/pause` and `/resume` | Pause or resume. |
| POST | `/v1/experiments/{id}/end` | `active` or `paused` to `ended`. **One way.** |
| POST | `/v1/experiments/{id}/archive` | Archive `draft`, `preview`, `ended`, or `failed`. **One way, no unarchive.** |
| PUT and DELETE | `/v1/experiments/{id}/schedule` | Set or clear `{start_at, end_at}`. After launch only `end_at` is editable. |
| GET | `/v1/experiments/{id}/results` | Latest results snapshot (beta). 202 until the first snapshot. Optional `breakdown=date`. |
| POST | `/v1/experiments/{id}/exports` | Start an async order export for a `date_range`. Answers 202 with a job. |
| GET | `/v1/exports/{id}` | Poll the export job. |

Statuses: `draft`, `preview`, `active`, `paused`, `ended`, `failed`, `archived`. Scheduling is not a status: a scheduled test is a `draft` or `preview` carrying a `schedule`.

`visual_editor` and `combined` tests are read and lifecycle only over the API; creating or amending one returns 501 `not_implemented`. Checkout block customizations and offer widgets are authored in the admin too, and read back read-only.

**When the user asks for a preview, the deliverable is the `test_group_preview_urls`, one clickable link per test group.** Each link uses the shop's preview key to assign the visitor to that test group. `template_preview_url` and `theme_preview_url` on a test group are not previews: they render the template with no test assignment. Use them only as a secondary check that the template renders.

The preview parameters work on any storefront page, so for a template or theme test, rewrite the URL's path to the page that shows the change (for example `/products/<handle>`) before handing it over.

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

- **price**: `prices[]` entries key on `product_variant_id`; sending `adjustment` re-derives every price not sent in the same request. Markets need the SCALE plan tier or above. At most 500 products, and 100 on most shops.
- **shipping**: Control must send `changes: []` (`control_offers_rates`); a rate without `shopify_rate_id` is a new rate and needs `name` and `price`.
- **template**: Control must **also** carry a `template_key` change. `changes: []` returns `template_required`.
- **theme**: Control may send `changes: []`; it resolves to the main theme.
- **url_redirect**: every `shared.url_redirect.rules[].key` needs a matching `destinations[].rule_key` in each variant. Writes accept `subject: path` and `match_type` of `exact`, `starts_with`, or `contains` only.
- **offer**: exactly one discount per change; `has_widgets` is read-only.

## Lifecycle rules

- Repeating an action that already holds (`start` on `active`, `pause` on `paused`) is a no-op 200, not an error. Safe to retry.
- An illegal transition returns 409 `invalid_status_transition`, and `details.allowed_actions` names what is legal. Relay that instead of guessing.
- 409 `checks_pending` means platform checks such as theme validation are still running; only `archive` works meanwhile. Poll `GET /v1/experiments/{id}` until the status settles, then retry.
- After launch only `name`, `hypothesis`, `primary_metric`, each test group's `name` and `split`, and `schedule.end_at` are writable. Anything else returns 409 `locked_field`. Sending a locked field with its current value is safe.
- Changing a `split` returns a new `assignment_version` and the `split_changed` warning. Visitors already in the test keep their test group, so the traffic already recorded still reflects the old split. Warn the user that it dilutes accumulated data before doing it.
- Entitlements are checked on create, `start`, and `resume`, never on `pause`, `end`, or `archive`. The user always keeps control of a live test.

**Ask before irreversible or traffic-affecting actions.** `start` puts real visitors into the test; `end` and `archive` cannot be undone. Never chain create to start in one breath unless the user asked to launch. Prefer create, then `preview`, then share the preview URLs, then let the user confirm, then `start`.

## Reading results

`GET /v1/experiments/{id}/results`. A 202 means the pipeline has not computed a snapshot yet. Tell the user to check back; do not poll in a tight loop. Polling faster than the pipeline refreshes returns the same snapshot with an unchanged `computed_at`.

The snapshot carries `verdict`, `winning_test_group_index`, `srm_status`, `analysis` (`credible_interval_level`, `confidence_level`), and one row per test group with `test_group_index`, `sample_size` (the visitor denominator), `session_count` (the denominator for `add_to_cart_rate` and `reached_checkout_rate`), the six metrics, `orders`, `revenue`, and `vs_control` (null on the control row) with `lift`, `bayesian` (`prob_beat_control`, `credible_interval`, `risk`, any of which may be null), and `frequentist` (`p_value`, `confidence_interval`).

`breakdown=date` adds `breakdown.rows`, one row per test group per day, each with the same fields plus `dimension_value`.

**The snapshot has no test group names.** Rows are identified by `test_group_index` only. Fetch `GET /v1/experiments/{id}` for `test_groups[].name` and `control`. Merchants rename their test groups, so never label a row from its index.

When summarizing results:

1. **Check `srm_status` first.** `mismatch` means the traffic split is broken and the results are not trustworthy. Say so prominently and stop short of a recommendation.
2. Report the `verdict` (`winner`, `loser`, `inconclusive`, `insufficient_data`) as the platform's call. Do not override it with your own reading of the p-value.
3. Quote lifts with their uncertainty: "revenue per visitor +6.2% (95% CI -1.1% to +13.4%)", never a bare point estimate. `lift` is a ratio: `0.062` means +6.2%.
4. On `insufficient_data` or a tiny `sample_size`, say the test needs more traffic. Do not extrapolate.
5. `profit_per_visitor` is null until COGS settings are configured. Omit it rather than reporting 0.

## Order exports

`POST /v1/experiments/{id}/exports` with `{"date_range": {"gte": ..., "lte": ...}}`. Both bounds are required and inclusive. The API answers 202 with a job; poll `GET /v1/exports/{id}` until `status` is `completed` or `failed`.

On `completed`, `url` is a signed link valid until `expires_at`. Download it in the same run. `truncated: true` means the export hit the row cap, currently 10,000 rows; narrow the range and export again.

The column schema matches the admin's order export and is in beta. Read the header row rather than assuming column names.

## Error handling (surface, do not swallow)

Every error has one shape: `{"error": {"type", "code", "message", "param", "details", "findings"}}`.

- **Relay `error.message` and `error.code` verbatim.** Messages are written to be actionable ("This token was revoked. Create a new one in Settings.").
- **422 validation**: `findings[]` lists every violation with a JSON-path `param`. Report all of them at once, fix the payload, retry once. Do not fix one finding at a time.
- **Success responses can carry a top-level `warnings` array** (non-blocking findings such as `split_changed` or `country_served_by_other_market`). Always show these. A 2xx with warnings is not a clean pass.
- **403 family**: `insufficient_scope`, `api_access_disabled`, `feature_not_in_plan` (`param` names the feature: `price`, `offer`, or `multi_market`), `subscription_inactive`, `billing_cap_reached`, `carrier_service_required`. These are account states. Explain the fix; do not retry.
- **401 family**: `missing_token`, `invalid_token`, `token_revoked`.
- **Launch guards**: `start` can return 422 on cross-test conflicts. A running theme test blocks every other type (`theme_test_running`). A resource already claimed by a running test is blocked, with its own finding code: products in a price test, delivery zones in a shipping test. The message does not name the conflicting test, so cross-reference `GET /v1/experiments?status=active` and tell the user which test holds the claim.
- **A storefront-script test can launch cleanly and still not render** when the ABConvert app embed is off. The API launch path does not block on it for price, theme, template, or URL redirect tests. Check the embed in the admin before launching one.
- 5xx `internal_error`: retry once with backoff, then report.
