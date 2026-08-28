# Guardrail monitor

Poll results on a schedule and pause a test when a guardrail metric falls too far below Control.

## What it does

1. Lists every active test with `GET /v1/experiments?status=active`.
2. Reads `GET /v1/experiments/{id}/results` for each one.
3. For every test group other than Control, compares the guardrail metric's `lift` against your threshold.
4. Calls `POST /v1/experiments/{id}/pause` when a breach clears all three gates.

You run it. A cron entry every 15 to 60 minutes fits the pipeline's refresh cadence. Polling faster returns the same snapshot with an unchanged `computed_at` and spends your read budget for nothing. ABConvert does not push you an alert, and webhook triggers are not available yet.

**This one needs a write token.** Pausing is a write, and new tokens default to read.

## Setup

```bash
export ABCONVERT_API_TOKEN="abcv_live_..."     # write scope
export GUARDRAIL_METRIC="conversion_rate"
export GUARDRAIL_MAX_DROP="0.10"
DRY_RUN=1 node examples/guardrail-monitor/monitor.mjs
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ABCONVERT_API_TOKEN` | yes | | Bearer token for one shop, write scope. |
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | Override for a dev backend. |
| `GUARDRAIL_METRIC` | no | `conversion_rate` | One of `revenue_per_visitor`, `average_order_value`, `conversion_rate`, `profit_per_visitor`, `add_to_cart_rate`, `reached_checkout_rate`. |
| `GUARDRAIL_MAX_DROP` | no | `0.10` | Relative drop that counts as a breach. `0.10` means 10% below Control. |
| `GUARDRAIL_MIN_SAMPLE` | no | `1000` | Visitors required in both test groups before the guardrail can fire. |
| `GUARDRAIL_MAX_P_VALUE` | no | `0.05` | Significance required before the guardrail can fire. |
| `GUARDRAIL_ONLY_IDS` | no | | Comma separated test IDs, to watch a subset. |
| `DRY_RUN` | no | | `1` reports breaches without pausing anything. |

Run it with `DRY_RUN=1` for a week before you let it pause anything. You are looking for the threshold that fires on a real problem and stays quiet the rest of the time.

## Reading the walkthrough

### Three gates, not one

A guardrail that pauses on the raw lift alone will pause healthy tests on their first morning, because a conversion rate measured on 40 visitors swings by 30% on noise. The script requires all three:

```js
lift < -MAX_DROP                                   // the drop is large enough to matter
sample_size >= MIN_SAMPLE  (both test groups)      // measured on enough traffic
frequentist.p_value <= MAX_P_VALUE                 // unlikely to be noise
```

`lift` is a ratio, not a percentage. `-0.062` means 6.2% below Control.

Each gate logs why it did not fire, so a near-miss shows up in your logs before it becomes a pause you have to explain.

### A null lift is a fourth outcome, not a pass

`lift` is null in two cases the contract names: Control's value is zero, or Control and this test group sit on strictly opposite sides of zero. `profit_per_visitor` reaches the second one whenever COGS and ad cost cross revenue, so a test group that falls from profit into loss has a real, large `difference` and no percentage at all.

`GUARDRAIL_MAX_DROP` is a percentage of Control, so there is nothing to compare it against there. Reading that as "within the guardrail" would blind the monitor to the exact case it exists for. The script logs the group as `REVIEW` with its absolute `difference` and leaves it running for a human:

```js
if (lift === null || lift === undefined) {
  return { breach: false, review: true, reason: `... Absolute difference ${difference}. Review by hand.` };
}
```

The run's last line counts how many test groups landed there, so a `REVIEW` cannot scroll past unnoticed.

### A sample ratio mismatch stops the check

When `srm_status` is `mismatch`, the observed traffic split does not match the configured one. Every comparison against Control is then suspect, including the one that would trigger a pause. The script logs it and moves on:

```js
if (results.srm_status === "mismatch") {
  console.warn("The traffic split is broken, so the guardrail cannot judge this test.");
  continue;
}
```

Pausing on a mismatch would look like a guardrail working and be a coin flip.

### Which row is Control

The results snapshot marks Control by omission: its `vs_control` is `null`. The `control: true` flag lives on the test, so the script reads the control index from `GET /v1/experiments/{id}` and matches it to the snapshot by `test_group_index`, falling back to the snapshot's own null `vs_control` if a test carries no flag. Do not assume Control is index 0.

### Pausing is idempotent

`POST /v1/experiments/{id}/pause` on a test that is already paused returns 200 and changes nothing. A run that crashes after pausing and gets retried does no harm.

Pausing also never checks entitlements. A shop whose subscription lapsed or whose usage cap is reached keeps full control of what is already live: `pause`, `end`, and `archive` all work.

### Pause, do not end

`pause` is reversible with `POST /v1/experiments/{id}/resume`. `end` is one way, and an ended test cannot be restarted. A monitor should never take the one-way action on its own.

## Ask Claude

> "Pause every active price test on this store and tell me which ones you paused."

> "Check all my active tests against a 10% conversion rate guardrail and tell me which ones you would pause and why."

> "Test 3021 got paused by my guardrail overnight. Tell me what the numbers looked like and whether resuming it is reasonable."

## Common mistakes

- **Firing on lift alone.** Without a sample floor and a significance gate, the monitor pauses winners that started slowly.
- **Pausing on an SRM.** A broken split invalidates the comparison the guardrail depends on.
- **Ending instead of pausing.** `end` cannot be undone. Automation gets the reversible action.
- **Polling every minute.** The endpoint reads a stored snapshot. You get the same `computed_at` and burn your 60 reads per minute.
- **Watching `profit_per_visitor` without COGS.** It reads `null` until COGS settings are configured, so the guardrail can never fire on it.
- **Treating a null `lift` as healthy.** It means no percentage exists, not that nothing moved. Read `difference`.
