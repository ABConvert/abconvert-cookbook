#!/usr/bin/env node
/**
 * 7 and 14 day test report, summarized by Claude, posted to Slack.
 *
 * Flow:
 *   1. GET /experiments?status=active, then keep the tests whose `started_at`
 *      lands on one of the day marks you configured. Each list row carries
 *      the test group names, which the results snapshot identifies by index
 *      only.
 *   2. GET /experiments/{id}/results?breakdown=date for the numbers.
 *   3. Ask Claude for a short summary.
 *   4. POST the summary to a Slack incoming webhook.
 *
 * Run it from your own scheduler, once a day.
 *
 * Environment:
 *   ABCONVERT_API_TOKEN   required, read scope is enough
 *   ABCONVERT_API_BASE    optional, default https://api.abconvert.io/v1
 *   ANTHROPIC_API_KEY     required unless SKIP_LLM=1
 *   SLACK_WEBHOOK_URL     required unless DRY_RUN=1
 *   REPORT_DAY_MARKS      optional, default "7,14"
 *   ANTHROPIC_MODEL       optional, default claude-sonnet-5
 *   DRY_RUN               optional, "1" prints to stdout instead of posting
 *   SKIP_LLM              optional, "1" posts the raw figures with no summary
 */

import {
  clientFromEnv,
  AbconvertApiError,
  MONEY_METRICS,
  describeComparison,
  formatQuantity,
  testGroupNames,
} from "../../lib/abconvert.mjs";

const DAY_MARKS = (process.env.REPORT_DAY_MARKS ?? "7,14")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_LLM = process.env.SKIP_LLM === "1";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between `started_at` and now, floored. */
function daysRunning(startedAt, now = Date.now()) {
  if (!startedAt) return null;
  return Math.floor((now - Date.parse(startedAt)) / DAY_MS);
}

/**
 * The list endpoint filters on `created_at`, not `started_at`, so pick the day
 * mark here. A test created weeks before it launched would slip through a
 * created_at filter.
 *
 * `daysRunning` floors whole days: a test that started at 16:20 is not at
 * day 7 until 16:20 seven days later. A run that gets skipped skips that
 * day's report with it.
 */
function atDayMark(experiment, now) {
  const days = daysRunning(experiment.started_at, now);
  return days !== null && DAY_MARKS.includes(days) ? days : null;
}

/** One plain-text block per test, which is both the Slack fallback and the LLM input. */
function renderTest({ experiment, results, dayMark }) {
  const names = testGroupNames(experiment);
  const metric = experiment.primary_metric ?? "revenue_per_visitor";
  const lines = [];

  lines.push(`Test ${experiment.id}: ${experiment.name}`);
  lines.push(`Type: ${experiment.type} | Day ${dayMark} | Primary metric: ${metric}`);
  if (experiment.hypothesis) lines.push(`Hypothesis: ${experiment.hypothesis}`);

  if (!results) {
    lines.push("No results snapshot yet. The analytics pipeline has not computed one.");
    return lines.join("\n");
  }

  lines.push(`Snapshot computed at: ${results.computed_at ?? "unknown"}`);
  lines.push(`Outcome: ${results.outcome ?? "none yet"}`);
  lines.push(`SRM check: ${results.srm_status ?? "unknown"}`);

  for (const group of results.test_groups ?? []) {
    const label = names.get(group.test_group_index) ?? `Test group ${group.test_group_index}`;
    // Money metrics come back as `{amount, currency}`, so they need formatting
    // rather than string interpolation. `amount` is printed as sent: these
    // values carry more than two decimals when the measurement needs them.
    const parts = [
      `visitors ${group.sample_size ?? 0}`,
      `orders ${group.orders ?? 0}`,
      `conversion ${formatQuantity(group.conversion_rate, { rate: true })}`,
      `RPV ${formatQuantity(group.revenue_per_visitor)}`,
      `AOV ${formatQuantity(group.average_order_value)}`,
      `revenue ${formatQuantity(group.revenue)}`,
    ];
    lines.push(`  ${label}: ${parts.join(", ")}`);

    const comparison = group.vs_control?.[metric];
    if (comparison) {
      // `describeComparison` quotes the lift with its interval where there is
      // one, and falls back to `difference` with `difference_interval` where
      // Control is zero or the two straddle zero and no percentage exists.
      const bits = [describeComparison(comparison, { metric })];
      if (comparison.bayesian?.prob_beat_control !== null && comparison.bayesian?.prob_beat_control !== undefined) {
        bits.push(`P(beats Control) ${(comparison.bayesian.prob_beat_control * 100).toFixed(0)}%`);
      }
      if (comparison.bayesian?.risk !== null && comparison.bayesian?.risk !== undefined) {
        bits.push(`risk ${formatQuantity(comparison.bayesian.risk, { rate: !MONEY_METRICS.includes(metric) })}`);
      }
      if (comparison.frequentist?.p_value !== null && comparison.frequentist?.p_value !== undefined) {
        bits.push(`p=${comparison.frequentist.p_value.toFixed(3)}`);
      }
      lines.push(`    vs Control on ${metric}: ${bits.join(", ")}`);
    }
  }

  const rows = results.breakdown?.rows ?? [];
  if (rows.length) {
    const days = [...new Set(rows.map((row) => row.dimension_value))].sort();
    const recent = days.slice(-5);
    lines.push(`  Last ${recent.length} days by test group:`);
    for (const day of recent) {
      const perGroup = rows
        .filter((row) => row.dimension_value === day)
        .sort((a, b) => a.test_group_index - b.test_group_index)
        .map((row) => {
          const label = names.get(row.test_group_index) ?? `#${row.test_group_index}`;
          return `${label} ${row.sample_size ?? 0} visitors / ${row.orders ?? 0} orders`;
        });
      lines.push(`    ${day}: ${perGroup.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Summarize with Claude. Raw HTTP because this cookbook stays dependency free.
 * In your own project, prefer the official SDK: npm install @anthropic-ai/sdk
 */
async function summarize(reportText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY, or set SKIP_LLM=1.");

  const system = [
    "You summarize A/B test results for a Shopify merchant's Slack channel.",
    "Rules:",
    "- Call the object a test. The units inside it are test groups: Control, Variant A, Variant B. Never say experiment, variation, or arm.",
    "- Lead with the decision: ship it, kill it, or keep running.",
    "- If srm_status is mismatch, say the traffic split is broken and that the numbers are not trustworthy, and stop short of a recommendation.",
    "- Quote every figure with its interval. Never give a bare point estimate.",
    "- Some comparisons have no percentage, because Control was zero or the two sit on opposite sides of zero. Those are quoted as an absolute difference in the metric's own unit. Repeat them that way; do not invent a percentage for them.",
    "- Money figures carry their own decimal places. Repeat them as written and do not round.",
    "- If the outcome is insufficient_data, say the test needs more traffic. Do not extrapolate.",
    "- Report the platform's outcome as the platform's call. Do not override it with your own reading of the p-value.",
    "- Plain text for Slack. No markdown headings, no tables, no emoji. Under 200 words per test.",
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system,
      messages: [
        {
          role: "user",
          content: `Summarize these test results for Slack.\n\n${reportText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API returned ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (body.stop_reason === "refusal") {
    throw new Error("Claude declined to answer this request.");
  }
  return body.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function postToSlack(text) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) throw new Error("Set SLACK_WEBHOOK_URL, or set DRY_RUN=1.");

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Slack returned ${response.status}: ${await response.text()}`);
  }
}

async function main() {
  const abconvert = clientFromEnv();
  const now = Date.now();

  const active = await abconvert.listAllExperiments({ status: "active" });
  const due = active
    .map((experiment) => ({ experiment, dayMark: atDayMark(experiment, now) }))
    .filter((entry) => entry.dayMark !== null);

  if (!due.length) {
    console.log(`No active test hit a day mark (${DAY_MARKS.join(", ")}) today. Nothing to report.`);
    return;
  }

  const reports = [];
  for (const { experiment, dayMark } of due) {
    // The list row already carries the test group names (`name`, `control`,
    // `split`), so only the snapshot needs fetching.
    const results = await abconvert.getResults(experiment.id, { breakdown: "date" });
    reports.push(renderTest({ experiment, results, dayMark }));
  }

  const raw = reports.join("\n\n");
  const summary = SKIP_LLM ? raw : await summarize(raw);
  const message = `ABConvert test report (${DAY_MARKS.map((d) => `day ${d}`).join(" and ")})\n\n${summary}`;

  if (DRY_RUN) {
    console.log(message);
    return;
  }

  await postToSlack(message);
  console.log(`Posted a report covering ${due.length} test(s) to Slack.`);
}

main().catch((error) => {
  if (error instanceof AbconvertApiError) {
    console.error(error.describe());
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
