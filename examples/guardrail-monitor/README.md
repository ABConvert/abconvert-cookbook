# Guardrail monitor

Poll results on a schedule and pause a test when a guardrail metric falls too far below Control.

## What it does

1. Lists every active test with `GET /v1/experiments?status=active`.
2. Reads `GET /v1/experiments/{id}/results` for each one.
3. For every test group other than Control, compares the guardrail metric's `lift` against your threshold.
4. Calls `POST /v1/experiments/{id}/pause` when a breach clears all three gates.

Run it from your own scheduler, every few hours. The endpoint reads a stored snapshot on the recompute cadence in the [API reference](https://docs.abconvert.io/api-reference/overview), so polling faster returns the same numbers. ABConvert does not push you an alert, and webhook triggers are not available yet.

**Read scope is enough to start.** Everything up to the pause is a read, so the `DRY_RUN=1` run below works on a read token, which is what new tokens default to. Grant write only once you let it pause for real.

## Setup

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."     # read scope is enough for DRY_RUN
export GUARDRAIL_METRIC="conversion_rate"
export GUARDRAIL_MAX_DROP="0.10"
DRY_RUN=1 node examples/guardrail-monitor/monitor.mjs
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ABCONVERT_API_TOKEN` | yes | | Bearer token for one shop. Read scope runs `DRY_RUN`; write scope is needed to pause. |
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | Override for a dev backend. |
| `GUARDRAIL_METRIC` | no | `conversion_rate` | One of `revenue_per_visitor`, `average_order_value`, `conversion_rate`, `profit_per_visitor`, `add_to_cart_rate`, `reached_checkout_rate`. |
| `GUARDRAIL_MAX_DROP` | no | `0.10` | Relative drop that counts as a breach. `0.10` means 10% below Control. |
| `GUARDRAIL_MIN_SAMPLE` | no | `1000` | Visitors required in both test groups before the guardrail can fire. |
| `GUARDRAIL_MAX_P_VALUE` | no | `0.05` | Significance required before the guardrail can fire. |
| `GUARDRAIL_ONLY_IDS` | no | | Comma separated test IDs, to watch a subset. |
| `DRY_RUN` | no | | `1` reports breaches without pausing anything. |

Run it with `DRY_RUN=1` for a week before you let it pause anything. You are looking for the threshold that fires on a real problem and stays quiet the rest of the time.

## How the check works

### A breach has to clear three gates

A conversion rate measured on 40 visitors swings by 30% on noise, so a guardrail on the raw lift alone pauses healthy tests on their first morning. Each gate below returns early instead of pausing, and logs why it did not fire.

```js
lift >= -MAX_DROP                                     // the drop is not large enough to matter
sample < MIN_SAMPLE || controlSampleSize < MIN_SAMPLE  // not measured on enough traffic
pValue === null || pValue > MAX_P_VALUE                // could still be noise
```

`lift` is a ratio, not a percentage. `-0.062` means 6.2% below Control.

### A null lift is not a pass

`lift` is null when no percentage against Control exists; the [API reference](https://docs.abconvert.io/api-reference/overview) names both cases. The script logs the test group as `REVIEW` with its absolute `difference` and leaves it running. Read `difference` before you decide anything.

### A sample ratio mismatch stops the check

When `srm_status` is `mismatch`, the observed traffic split does not match the configured one, so every comparison against Control is suspect. The script logs the test and moves on without pausing it.

### Control is not always index 0

The script reads the `control: true` flag off the list row's `test_groups` and matches it to the snapshot by `test_group_index`. Do not assume Control is index 0.

### Pause, do not end

`pause` is reversible with `POST /v1/experiments/{id}/resume`. `end` is one way, and an ended test cannot be restarted. Pausing is idempotent, so a run that crashes after pausing is safe to retry.

`pause` also runs no entitlement check, so the monitor keeps working when a subscription lapses or a usage cap is reached. See [Feature availability](https://docs.abconvert.io/api-reference/overview#feature-availability).

## Ask Claude

> "Pause every active price test on this store and tell me which ones you paused."

> "Check all my active tests against a 10% conversion rate guardrail and tell me which ones you would pause and why."

> "Test 3021 got paused by my guardrail overnight. Tell me what the numbers looked like and whether resuming it is reasonable."

## Common mistakes

- **Firing on lift alone.** Without a sample floor and a significance gate, the monitor pauses winners that started slowly.
- **Ending instead of pausing.** `end` cannot be undone. Automation gets the reversible action.
- **Watching `profit_per_visitor` without COGS.** It reads `null` until COGS settings are configured, so the guardrail can never fire on it.
