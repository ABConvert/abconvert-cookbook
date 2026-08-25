#!/usr/bin/env node
/**
 * Order export: start the job, poll it, download the CSV, analyze it locally.
 *
 * Flow:
 *   1. POST /experiments/{id}/exports with a date_range -> 202 and a job
 *   2. GET /exports/{id} until status is completed or failed
 *   3. Download the signed `url` before `expires_at`
 *   4. Parse the CSV and summarize per test group
 *
 * Environment:
 *   ABCONVERT_API_TOKEN     required, WRITE scope (starting an export is a write)
 *   ABCONVERT_API_BASE      optional, default https://api.abconvert.io/v1
 *   EXPORT_EXPERIMENT_ID    required, the test's numeric ID as a string
 *   EXPORT_GTE              optional, calendar day YYYY-MM-DD. Default 29 days ago.
 *   EXPORT_LTE              optional, calendar day YYYY-MM-DD. Default today.
 *   EXPORT_SAMPLE_BASIS     optional, "assignment" (default) or "exposure"
 *   EXPORT_OUT_DIR          optional, default ./out
 *   EXPORT_POLL_MS          optional, default 5000
 *   EXPORT_TIMEOUT_MS       optional, default 600000 (10 minutes)
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { clientFromEnv, AbconvertApiError, sleep } from "../../lib/abconvert.mjs";

const EXPERIMENT_ID = process.env.EXPORT_EXPERIMENT_ID;
const OUT_DIR = process.env.EXPORT_OUT_DIR ?? "./out";
const POLL_MS = Number(process.env.EXPORT_POLL_MS ?? "5000");
const TIMEOUT_MS = Number(process.env.EXPORT_TIMEOUT_MS ?? "600000");
const SAMPLE_BASIS = process.env.EXPORT_SAMPLE_BASIS ?? null;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `date_range` bounds are calendar days in the store's timezone, not
 * timestamps: `2026-08-01`, never `2026-08-01T00:00:00Z`. Both are inclusive,
 * so a 30-day window ends 29 days after it starts.
 */
const asCalendarDay = (date) => date.toISOString().slice(0, 10);

/** Read the run's inputs, or fail with a message that says how to fix it. */
function readConfig() {
  if (!EXPERIMENT_ID) {
    throw new Error('Set EXPORT_EXPERIMENT_ID to the test ID, for example "3021".');
  }
  if (SAMPLE_BASIS && !["assignment", "exposure"].includes(SAMPLE_BASIS)) {
    throw new Error('EXPORT_SAMPLE_BASIS must be "assignment" or "exposure".');
  }

  const dateRange = {
    gte: process.env.EXPORT_GTE ?? asCalendarDay(new Date(Date.now() - 29 * DAY_MS)),
    lte: process.env.EXPORT_LTE ?? asCalendarDay(new Date()),
  };

  for (const [bound, value] of Object.entries(dateRange)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`EXPORT_${bound.toUpperCase()} must be a calendar day, for example 2026-08-01. Got "${value}".`);
    }
  }

  return dateRange;
}

/**
 * RFC 4180 CSV parser: handles quoted fields, embedded commas, embedded
 * newlines, and doubled quotes. Enough for an export file, and no dependency.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.length > 1 || entry[0] !== "");
}

/**
 * The export column schema is in beta and the docs publish the list, so this
 * matches column names case insensitively against a few likely spellings
 * instead of hard coding one. When a column is missing, the script prints the
 * header it actually got and says which field it could not find.
 */
const COLUMN_CANDIDATES = {
  testGroup: ["test_group", "test group", "variant", "variation", "group", "group_name", "test_group_name"],
  orderTotal: ["total", "order_total", "total_price", "revenue", "order_value", "subtotal"],
  orderId: ["order_id", "order", "order_name", "order_number", "name"],
  orderedAt: ["ordered_at", "created_at", "order_date", "date", "processed_at"],
};

function resolveColumns(header) {
  const normalized = header.map((name) => name.trim().toLowerCase());
  const resolved = {};
  for (const [key, candidates] of Object.entries(COLUMN_CANDIDATES)) {
    const index = normalized.findIndex((name) => candidates.includes(name));
    resolved[key] = index === -1 ? null : index;
  }
  return resolved;
}

const toNumber = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Orders, revenue, and average order value per test group. */
function analyze(rows) {
  if (!rows.length) return { empty: true };

  const header = rows[0];
  const columns = resolveColumns(header);
  const body = rows.slice(1);

  if (columns.testGroup === null || columns.orderTotal === null) {
    return {
      unmapped: true,
      header,
      missing: [
        columns.testGroup === null ? "test group" : null,
        columns.orderTotal === null ? "order total" : null,
      ].filter(Boolean),
      rowCount: body.length,
    };
  }

  const perGroup = new Map();
  let unparsedTotals = 0;

  for (const row of body) {
    const group = (row[columns.testGroup] ?? "").trim() || "(unlabeled)";
    const total = toNumber(row[columns.orderTotal]);
    if (total === null) unparsedTotals += 1;

    const bucket = perGroup.get(group) ?? { group, orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue += total ?? 0;
    perGroup.set(group, bucket);
  }

  const groups = [...perGroup.values()]
    .map((bucket) => ({
      ...bucket,
      averageOrderValue: bucket.orders ? bucket.revenue / bucket.orders : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { groups, rowCount: body.length, unparsedTotals };
}

async function main() {
  const dateRange = readConfig();
  const abconvert = clientFromEnv();

  console.log(`Starting an order export for test ${EXPERIMENT_ID}`);
  console.log(`  Range: ${dateRange.gte} to ${dateRange.lte} (calendar days, both inclusive)`);
  if (SAMPLE_BASIS) console.log(`  Sample basis: ${SAMPLE_BASIS}`);

  // The Idempotency-Key is derived from the request itself, so a retry of the
  // same export carries the same key and returns the original job instead of
  // starting a second one. A different range is a different request and gets
  // its own key: reusing a key with a different body returns 409.
  //
  // Set EXPORT_IDEMPOTENCY_KEY to supply your own when a queue owns the retry.
  const idempotencyKey =
    process.env.EXPORT_IDEMPOTENCY_KEY ??
    `cookbook-export-${EXPERIMENT_ID}-${dateRange.gte}-${dateRange.lte}-${SAMPLE_BASIS ?? "assignment"}`;

  let job = await abconvert.createExport(EXPERIMENT_ID, dateRange, {
    idempotencyKey,
    sampleBasis: SAMPLE_BASIS,
  });
  console.log(`  Job ${job.id} accepted, status ${job.status}.`);

  const deadline = Date.now() + TIMEOUT_MS;
  while (job.status === "pending" || job.status === "processing") {
    if (Date.now() > deadline) {
      throw new Error(`Export ${job.id} was still ${job.status} after ${TIMEOUT_MS} ms. Poll it again later.`);
    }
    await sleep(POLL_MS);
    job = await abconvert.getExport(job.id);
    console.log(`  ${job.id}: ${job.status}`);
  }

  if (job.status === "failed") {
    throw new Error(`Export ${job.id} failed: ${job.failure_reason ?? "no reason given"}`);
  }
  if (!job.url) {
    throw new Error(`Export ${job.id} completed without a download URL.`);
  }
  // The link is signed and expires. Download it now, not later.
  console.log(`  Downloading (link valid until ${job.expires_at ?? "unknown"})`);
  const response = await fetch(job.url);
  if (!response.ok) {
    throw new Error(`Download returned ${response.status}: ${await response.text()}`);
  }
  const csv = await response.text();

  await mkdir(OUT_DIR, { recursive: true });
  const csvPath = path.join(OUT_DIR, `orders-${EXPERIMENT_ID}-${job.id}.csv`);
  await writeFile(csvPath, csv, "utf8");
  console.log(`  Saved ${csvPath} (${csv.length.toLocaleString("en-US")} bytes)`);

  const rows = parseCsv(csv);
  const analysis = analyze(rows);

  if (analysis.empty) {
    console.log("The export has no rows for that range.");
    return;
  }

  if (analysis.unmapped) {
    console.log(`Parsed ${analysis.rowCount} row(s), but could not find a column for: ${analysis.missing.join(", ")}.`);
    console.log(`Columns in this export: ${analysis.header.join(", ")}`);
    console.log("Add the right name to COLUMN_CANDIDATES in this script. The export schema is in beta.");
    return;
  }

  console.log("");
  console.log(`Orders by test group (${analysis.rowCount} row(s))`);
  console.log("  Test group                Orders     Revenue        AOV");
  for (const group of analysis.groups) {
    console.log(
      `  ${group.group.padEnd(24).slice(0, 24)}  ${String(group.orders).padStart(6)}  ${group.revenue.toFixed(2).padStart(10)}  ${group.averageOrderValue.toFixed(2).padStart(9)}`,
    );
  }
  if (analysis.unparsedTotals) {
    console.log(`  ${analysis.unparsedTotals} row(s) had a total this script could not parse and counted as 0.`);
  }
  console.log("");
  console.log("These are raw order figures with no statistics attached. For lift, significance, and a verdict, read GET /v1/experiments/{id}/results.");
}

main().catch((error) => {
  if (error instanceof AbconvertApiError) {
    console.error(error.describe());
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
