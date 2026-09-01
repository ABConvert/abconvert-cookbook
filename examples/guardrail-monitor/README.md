# Guardrail monitor

Poll results on a schedule and pause a test when a guardrail metric falls too far below Control.

## What it does

1. Lists every active test with `GET /v1/experiments?status=active`.
2. Reads `GET /v1/experiments/{id}/results` for each one.
3. For every test group other than Control, compares the guardrail metric's `lift` against your threshold.
4. Calls `POST /v1/experiments/{id}/pause` when a breach passes all three gates:
   - The drop is larger than `GUARDRAIL_MAX_DROP`.
   - Both test groups have at least `GUARDRAIL_MIN_SAMPLE` visitors.
   - The difference is significant at `GUARDRAIL_MAX_P_VALUE`.

   The last two gates stop false alarms. A metric measured on 40 visitors swings by 30% on noise, so without them the monitor pauses healthy tests on their first morning.

Run it from your own scheduler, every few hours. Polling faster returns the same numbers: the endpoint reads a stored snapshot, which recomputes about every 6 hours ([results reference](https://docs.abconvert.io/api-reference/results/retrieve-the-results-snapshot)). ABConvert does not send alerts, and webhooks are not available yet.

[`monitor.mjs`](monitor.mjs) handles the edge cases and explains each one inline: a null `lift`, a sample ratio mismatch, finding which row is Control, and why the action is `pause` and never `end`. Read it before you tune anything.

`pause` runs no entitlement check, so the monitor keeps working when a subscription lapses or a usage cap is reached. See [Feature availability](https://docs.abconvert.io/api-reference/overview#feature-availability).

**Read scope is enough to start.** Everything up to the pause is a read, so the `DRY_RUN=1` run below works on a read token. New tokens default to read scope. Grant write only when you let it pause for real.

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
| `ABCONVERT_API_BASE` | no | `https://api.abconvert.io/v1` | You rarely need to set it. |
| `GUARDRAIL_METRIC` | no | `conversion_rate` | One of `revenue_per_visitor`, `average_order_value`, `conversion_rate`, `profit_per_visitor`, `add_to_cart_rate`, `reached_checkout_rate`. |
| `GUARDRAIL_MAX_DROP` | no | `0.10` | Relative drop that counts as a breach, as a ratio of Control: `0.10` means 10% below. |
| `GUARDRAIL_MIN_SAMPLE` | no | `1000` | Visitors required in both test groups before the guardrail can fire. |
| `GUARDRAIL_MAX_P_VALUE` | no | `0.05` | Significance required before the guardrail can fire. |
| `GUARDRAIL_ONLY_IDS` | no | | Comma separated test IDs, to watch a subset. |
| `DRY_RUN` | no | | `1` reports breaches without pausing anything. |

Run it with `DRY_RUN=1` for a week before you let it pause anything. You are looking for the threshold that fires on a real problem and stays quiet the rest of the time.

## Ask an agent

> "Pause every active price test on this store and tell me which ones you paused."

> "Check all my active tests against a 10% conversion rate guardrail and tell me which ones you would pause and why."

> "Test 3021 got paused by my guardrail overnight. Tell me what the numbers looked like and whether resuming it is reasonable."

## Common mistakes

- **Firing on lift alone.** Without a sample floor and a significance gate, the monitor pauses winners that started slowly.
- **Ending instead of pausing.** `end` cannot be undone. Automation gets the reversible action: `pause` is idempotent and reverses with `POST /v1/experiments/{id}/resume`.
- **Watching `profit_per_visitor` without COGS.** It reads `null` until COGS settings are configured, so the guardrail can never fire on it.
