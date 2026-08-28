#!/usr/bin/env node
/**
 * Agency portfolio dashboard: every store, every test, one page.
 *
 * Flow, per store token:
 *   1. GET /experiments?status=active&include=results_summary
 *      and GET /experiments?status=paused&include=results_summary
 *      One read per page of 100 tests, summary inlined. No per-test call.
 *   2. GET /experiments/{id}/results only for the tests the summary says are
 *      decided, because uncertainty lives on that endpoint alone
 *   3. Aggregate into one HTML page and one Markdown file
 *
 * A token reaches exactly one shop, so multi-store work means one token per
 * store and one pass per token. Run it nightly from your own scheduler.
 *
 * Environment:
 *   ABCONVERT_API_TOKENS   required, comma separated "label=token" pairs
 *   ABCONVERT_API_TOKEN    accepted as a single-store fallback
 *   ABCONVERT_API_BASE     optional, default https://api.abconvert.io/v1
 *   DASHBOARD_OUT_DIR      optional, default ./out
 *   DASHBOARD_STATUSES     optional, default "active,paused"
 *   DASHBOARD_DETAIL       optional, "decided" (default), "all", or "none"
 *   REQUEST_SPACING_MS     optional, default 1100 (pace against 60 reads/min)
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createClient,
  AbconvertApiError,
  EXPERIMENT_STATUSES,
  comparisonRank,
  describeComparison,
  redactToken,
  sleep,
  testGroupNames,
} from "../../lib/abconvert.mjs";

const OUT_DIR = process.env.DASHBOARD_OUT_DIR ?? "./out";
const SPACING_MS = Number(process.env.REQUEST_SPACING_MS ?? "1100");
const DETAIL_MODES = ["decided", "all", "none"];
const DETAIL = process.env.DASHBOARD_DETAIL ?? "decided";
const STATUSES = (process.env.DASHBOARD_STATUSES ?? "active,paused")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!DETAIL_MODES.includes(DETAIL)) {
  throw new Error(`DASHBOARD_DETAIL must be one of: ${DETAIL_MODES.join(", ")}`);
}

for (const status of STATUSES) {
  if (!EXPERIMENT_STATUSES.includes(status)) {
    throw new Error(`DASHBOARD_STATUSES contains "${status}". Valid: ${EXPERIMENT_STATUSES.join(", ")}`);
  }
}

/** Parse `store-a=abcv_live_x,store-b=abcv_live_y` into [{label, token}]. */
function parseStores(env = process.env) {
  const raw = env.ABCONVERT_API_TOKENS;
  if (raw) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const at = entry.indexOf("=");
        if (at === -1) return { label: `store-${redactToken(entry)}`, token: entry };
        return { label: entry.slice(0, at).trim(), token: entry.slice(at + 1).trim() };
      });
  }
  if (env.ABCONVERT_API_TOKEN) {
    return [{ label: "store", token: env.ABCONVERT_API_TOKEN }];
  }
  throw new Error('Set ABCONVERT_API_TOKENS to "label=token,label=token", one entry per store.');
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const DAY_MS = 24 * 60 * 60 * 1000;

function daysRunning(startedAt) {
  if (!startedAt) return null;
  return Math.floor((Date.now() - Date.parse(startedAt)) / DAY_MS);
}

/**
 * Flatten one test into a dashboard row.
 *
 * `experiment` is a list row read with `?include=results_summary`, so it
 * already carries the test group names and `results_summary`. `results` is the
 * full snapshot, present only for the tests this run fetched detail for.
 *
 * The summary deliberately carries no comparison against Control. Uncertainty
 * lives on `GET /experiments/{id}/results` alone, so that a list page cannot be
 * mistaken for a result you can act on. This dashboard honors that: the lift
 * column fills in only where the snapshot was read.
 */
function toRow({ store, experiment, results }) {
  const names = testGroupNames(experiment);
  const metric = experiment.primary_metric ?? "revenue_per_visitor";
  const summary = experiment.results_summary ?? null;

  const row = {
    store,
    id: experiment.id,
    name: experiment.name,
    type: experiment.type,
    status: experiment.status,
    metric,
    days: daysRunning(experiment.started_at),
    outcome: summary?.outcome ?? results?.outcome ?? null,
    srm: summary?.srm_status ?? results?.srm_status ?? null,
    computedAt: summary?.computed_at ?? results?.computed_at ?? null,
    hasSnapshot: Boolean(summary || results),
    visitors: 0,
    best: null,
    bestUnavailable: null,
  };

  for (const group of summary?.test_groups ?? results?.test_groups ?? []) {
    row.visitors += group.sample_size ?? 0;
  }

  if (!results) {
    row.bestUnavailable = row.hasSnapshot ? "snapshot not read" : "no snapshot yet";
    return row;
  }

  // Best non-control test group on the primary metric.
  //
  // Rank on `difference`, which every comparison carries. Ranking on `lift`
  // drops the group whose lift is null, and that is the group that crossed
  // zero — the one most worth looking at.
  const candidates = (results.test_groups ?? [])
    .filter((group) => group.vs_control?.[metric])
    .map((group) => ({
      name: names.get(group.test_group_index) ?? `Test group ${group.test_group_index}`,
      summary: describeComparison(group.vs_control[metric], { metric }),
      rank: comparisonRank(group.vs_control[metric]),
      probability: group.vs_control[metric].bayesian?.prob_beat_control ?? null,
    }))
    .filter((candidate) => candidate.rank !== null)
    .sort((a, b) => b.rank - a.rank);

  row.best = candidates[0] ?? null;
  if (!row.best) row.bestUnavailable = "no comparison yet";
  return row;
}

/** Fetch the full snapshot for this test? */
function wantsDetail(experiment) {
  if (DETAIL === "none") return false;
  if (DETAIL === "all") return true;
  const outcome = experiment.results_summary?.outcome;
  return outcome === "winner" || outcome === "loser";
}

/**
 * Collect every row for one store token.
 *
 * One list read per page covers a whole store, because `include=results_summary`
 * inlines the summary. Only the tests that need uncertainty cost a second read,
 * and those are paced.
 */
async function collectStore({ label, token }) {
  const client = createClient({ token });
  const rows = [];
  const errors = [];

  for (const status of STATUSES) {
    const experiments = await client.listAllExperiments({ status, include: "results_summary" });
    for (const experiment of experiments) {
      let results = null;
      if (wantsDetail(experiment)) {
        await sleep(SPACING_MS);
        try {
          results = await client.getResults(experiment.id);
        } catch (error) {
          const detail = error instanceof AbconvertApiError ? error.describe() : error.message;
          errors.push(`${label} / test ${experiment.id}: ${detail}`);
        }
      }
      rows.push(toRow({ store: label, experiment, results }));
    }
  }

  return { rows, errors };
}

function renderMarkdown({ rows, errors, generatedAt }) {
  const lines = [];
  lines.push(`# Test portfolio`);
  lines.push("");
  lines.push(`Generated ${generatedAt}. ${rows.length} test(s) across ${new Set(rows.map((r) => r.store)).size} store(s).`);
  lines.push("");
  lines.push("| Store | Test | Type | Status | Days | Visitors | Verdict | SRM | Best test group |");
  lines.push("|---|---|---|---|---|---|---|---|---|");

  for (const row of rows) {
    const best = row.best ? `${row.best.name} ${row.best.summary}` : (row.bestUnavailable ?? "n/a");
    lines.push(
      `| ${row.store} | ${row.id} ${row.name} | ${row.type} | ${row.status} | ${row.days ?? "n/a"} | ${row.visitors} | ${row.outcome ?? "none yet"} | ${row.srm ?? "unknown"} | ${best} |`,
    );
  }

  if (errors.length) {
    lines.push("");
    lines.push("## Errors");
    lines.push("");
    for (const error of errors) lines.push(`- ${error}`);
  }

  lines.push("");
  return lines.join("\n");
}

function renderHtml({ rows, errors, generatedAt }) {
  const badge = (row) => {
    if (row.srm === "mismatch") return '<span class="flag flag-bad">SRM mismatch</span>';
    if (row.outcome === "winner") return '<span class="flag flag-good">winner</span>';
    if (row.outcome === "loser") return '<span class="flag flag-bad">loser</span>';
    if (row.outcome) return `<span class="flag">${escapeHtml(row.outcome)}</span>`;
    return '<span class="flag">no outcome yet</span>';
  };

  const body = rows
    .map((row) => {
      const best = row.best
        ? `${escapeHtml(row.best.name)} <span class="muted">${escapeHtml(row.best.summary)}</span>`
        : `<span class="muted">${escapeHtml(row.bestUnavailable ?? "n/a")}</span>`;
      return `<tr>
  <td>${escapeHtml(row.store)}</td>
  <td><strong>${escapeHtml(row.name)}</strong><br><span class="muted">${escapeHtml(row.id)} · ${escapeHtml(row.type)}</span></td>
  <td>${escapeHtml(row.status)}</td>
  <td>${row.days ?? '<span class="muted">n/a</span>'}</td>
  <td>${row.visitors.toLocaleString("en-US")}</td>
  <td>${badge(row)}</td>
  <td>${best}</td>
</tr>`;
    })
    .join("\n");

  const errorBlock = errors.length
    ? `<section><h2>Errors</h2><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test portfolio</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #6b7280; --line: #e5e7eb; --bg: #ffffff; --good: #0a7d32; --bad: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececec; --muted: #9ca3af; --line: #33363b; --bg: #17181a; } }
  body { margin: 0; padding: 2rem 1.5rem; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .muted { color: var(--muted); font-size: .85em; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 60rem; margin-top: 1.5rem; }
  th, td { text-align: left; padding: .6rem .7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .flag { font-size: .8rem; padding: .1rem .45rem; border: 1px solid var(--line); border-radius: 999px; }
  .flag-good { color: var(--good); border-color: currentColor; }
  .flag-bad { color: var(--bad); border-color: currentColor; }
  section { margin-top: 2rem; }
</style>
</head>
<body>
<h1>Test portfolio</h1>
<p class="muted">Generated ${escapeHtml(generatedAt)} · ${rows.length} test(s) across ${new Set(rows.map((r) => r.store)).size} store(s)</p>
<div class="wrap">
<table>
<thead><tr><th>Store</th><th>Test</th><th>Status</th><th>Days</th><th>Visitors</th><th>Result</th><th>Best test group</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>
${errorBlock}
</body>
</html>
`;
}

async function main() {
  const stores = parseStores();
  console.log(`Reading ${stores.length} store(s): ${stores.map((s) => `${s.label} (${redactToken(s.token)})`).join(", ")}`);

  const rows = [];
  const errors = [];

  for (const store of stores) {
    try {
      const result = await collectStore(store);
      rows.push(...result.rows);
      errors.push(...result.errors);
      console.log(`  ${store.label}: ${result.rows.length} test(s)`);
    } catch (error) {
      const detail = error instanceof AbconvertApiError ? error.describe() : error.message;
      errors.push(`${store.label}: ${detail}`);
      console.error(`  ${store.label}: ${detail}`);
    }
  }

  // Longest running first: those are the ones due a decision.
  rows.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  const generatedAt = new Date().toISOString();
  await mkdir(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, "portfolio.html");
  const mdPath = path.join(OUT_DIR, "portfolio.md");
  await writeFile(htmlPath, renderHtml({ rows, errors, generatedAt }), "utf8");
  await writeFile(mdPath, renderMarkdown({ rows, errors, generatedAt }), "utf8");

  console.log(`Wrote ${htmlPath} and ${mdPath}.`);
  if (errors.length) console.log(`${errors.length} error(s) recorded in the dashboard.`);
}

main().catch((error) => {
  if (error instanceof AbconvertApiError) {
    console.error(error.describe());
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
