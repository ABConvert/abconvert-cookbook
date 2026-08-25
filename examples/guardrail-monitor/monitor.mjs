#!/usr/bin/env node
/**
 * Guardrail monitor: pause a test when a metric drops too far below Control.
 *
 * Flow:
 *   1. GET /experiments?status=active
 *   2. GET /experiments/{id}/results for each one
 *   3. For every test group other than Control, check the guardrail metric's
 *      lift against your threshold
 *   4. POST /experiments/{id}/pause when a breach clears every gate
 *
 * Run it from your own scheduler. Every 15 to 60 minutes is plenty: the
 * results endpoint reads a stored snapshot, so polling faster returns the same
 * numbers and spends your rate limit.
 *
 * Environment:
 *   ABCONVERT_API_TOKEN     required, WRITE scope (pausing is a write)
 *   ABCONVERT_API_BASE      optional, default https://api.abconvert.io/v1
 *   GUARDRAIL_METRIC        optional, default conversion_rate
 *   GUARDRAIL_MAX_DROP      optional, default 0.10 (pause at 10% below Control)
 *   GUARDRAIL_MIN_SAMPLE    optional, default 1000 visitors per test group
 *   GUARDRAIL_MAX_P_VALUE   optional, default 0.05 (require significance)
 *   GUARDRAIL_ONLY_IDS      optional, comma separated test IDs to watch
 *   DRY_RUN                 optional, "1" reports breaches without pausing
 */

import {
  clientFromEnv,
  AbconvertApiError,
  PRIMARY_METRICS,
  formatLift,
  formatInterval,
  reportWarnings,
  testGroupNames,
} from "../../lib/abconvert.mjs";

const METRIC = process.env.GUARDRAIL_METRIC ?? "conversion_rate";
const MAX_DROP = Number(process.env.GUARDRAIL_MAX_DROP ?? "0.10");
const MIN_SAMPLE = Number(process.env.GUARDRAIL_MIN_SAMPLE ?? "1000");
const MAX_P_VALUE = Number(process.env.GUARDRAIL_MAX_P_VALUE ?? "0.05");
const ONLY_IDS = (process.env.GUARDRAIL_ONLY_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const DRY_RUN = process.env.DRY_RUN === "1";

if (!PRIMARY_METRICS.includes(METRIC)) {
  throw new Error(`GUARDRAIL_METRIC must be one of: ${PRIMARY_METRICS.join(", ")}`);
}

/**
 * Decide whether one test group breaches the guardrail.
 *
 * Three gates, all of which must pass before this pauses anything:
 *   - the drop is worse than MAX_DROP
 *   - both test groups have at least MIN_SAMPLE visitors
 *   - the difference is significant at MAX_P_VALUE
 *
 * The sample and significance gates exist because a metric on 40 visitors
 * swings by 30% on its own. Without them the monitor pauses healthy tests on
 * their first morning.
 */
function evaluateGroup({ group, controlSampleSize }) {
  const comparison = group.vs_control?.[METRIC];
  if (!comparison) return { breach: false, reason: "no comparison against Control" };

  const { lift } = comparison;
  if (lift === null || lift === undefined) {
    return { breach: false, reason: "lift not computed yet" };
  }
  if (lift >= -MAX_DROP) {
    return { breach: false, reason: `lift ${formatLift(lift)} is within the guardrail` };
  }

  const sample = group.sample_size ?? 0;
  if (sample < MIN_SAMPLE || controlSampleSize < MIN_SAMPLE) {
    return {
      breach: false,
      reason: `lift ${formatLift(lift)} breaches the threshold but sample is too small (${sample} vs Control ${controlSampleSize}, need ${MIN_SAMPLE})`,
    };
  }

  const pValue = comparison.frequentist?.p_value;
  if (pValue === null || pValue === undefined) {
    return { breach: false, reason: `lift ${formatLift(lift)} breaches the threshold but no p-value is available` };
  }
  if (pValue > MAX_P_VALUE) {
    return {
      breach: false,
      reason: `lift ${formatLift(lift)} breaches the threshold but p=${pValue.toFixed(3)} is above ${MAX_P_VALUE}`,
    };
  }

  const interval =
    formatInterval(comparison.frequentist?.confidence_interval) ??
    formatInterval(comparison.bayesian?.credible_interval);

  return {
    breach: true,
    reason: `${METRIC} is ${formatLift(lift)} against Control${interval ? ` (interval ${interval})` : ""}, p=${pValue.toFixed(3)}, ${sample} visitors`,
  };
}

/** Check one test. Returns a list of findings, one per non-control test group. */
function evaluateTest({ experiment, results }) {
  const names = testGroupNames(experiment);
  const controlIndex = (experiment.test_groups ?? []).findIndex((group) => group.control === true);
  const control = (results.test_groups ?? []).find((row) => row.test_group_index === controlIndex);
  const controlSampleSize = control?.sample_size ?? 0;

  return (results.test_groups ?? [])
    .filter((row) => row.test_group_index !== controlIndex)
    .map((group) => ({
      name: names.get(group.test_group_index) ?? `Test group ${group.test_group_index}`,
      index: group.test_group_index,
      ...evaluateGroup({ group, controlSampleSize }),
    }));
}

async function main() {
  const abconvert = clientFromEnv();

  let active = await abconvert.listAllExperiments({ status: "active" });
  if (ONLY_IDS.length) active = active.filter((experiment) => ONLY_IDS.includes(experiment.id));

  if (!active.length) {
    console.log("No active test to check.");
    return;
  }

  console.log(
    `Checking ${active.length} active test(s). Guardrail: ${METRIC} may not fall more than ${(MAX_DROP * 100).toFixed(0)}% below Control.`,
  );

  let paused = 0;
  for (const summary of active) {
    const results = await abconvert.getResults(summary.id);
    if (!results) {
      console.log(`  ${summary.id} ${summary.name}: no results snapshot yet, skipping.`);
      continue;
    }

    // A broken split makes every comparison meaningless, so never pause on one.
    // Raise it to a human instead.
    if (results.srm_status === "mismatch") {
      console.warn(
        `  ${summary.id} ${summary.name}: sample ratio mismatch. The traffic split is broken, so the guardrail cannot judge this test. Investigate it by hand.`,
      );
      continue;
    }

    const experiment = await abconvert.getExperiment(summary.id);
    const findings = evaluateTest({ experiment, results });
    const breaches = findings.filter((finding) => finding.breach);

    for (const finding of findings) {
      const mark = finding.breach ? "BREACH" : "ok";
      console.log(`  ${summary.id} ${summary.name} / ${finding.name}: ${mark} - ${finding.reason}`);
    }

    if (!breaches.length) continue;

    if (DRY_RUN) {
      console.log(`  ${summary.id}: DRY_RUN, not pausing.`);
      continue;
    }

    // Pausing is idempotent: a test that is already paused answers 200 and
    // changes nothing, so a repeated run is safe.
    const updated = await abconvert.pauseExperiment(summary.id);
    reportWarnings(`test ${summary.id}`, updated);
    console.log(`  ${summary.id}: paused. Status is now ${updated.status}.`);
    paused += 1;
  }

  console.log(DRY_RUN ? "Done (dry run)." : `Done. Paused ${paused} test(s).`);
}

main().catch((error) => {
  if (error instanceof AbconvertApiError) {
    console.error(error.describe());
    // 409 invalid_status_transition carries the legal actions as data.
    if (error.code === "invalid_status_transition" && error.details?.allowed_actions) {
      console.error(`Allowed actions: ${error.details.allowed_actions.join(", ")}`);
    }
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
