/**
 * Minimal ABConvert Public API client.
 *
 * Node 20+, no dependencies, `fetch` only. Every example in this repo imports
 * this file, so the error envelope, pagination, and rate-limit handling are
 * written once.
 *
 * Contract: https://api.abconvert.io/v1
 * Reference: https://docs.abconvert.io/api-reference/overview
 */

import { randomUUID } from "node:crypto";

export const DEFAULT_API_BASE = "https://api.abconvert.io/v1";

/** Statuses the API publishes. Anything else is a bug in your code, not a new state. */
export const EXPERIMENT_STATUSES = [
  "draft",
  "preview",
  "active",
  "paused",
  "ended",
  "failed",
  "archived",
];

/** Metrics a test can be judged on. */
export const PRIMARY_METRICS = [
  "revenue_per_visitor",
  "average_order_value",
  "conversion_rate",
  "profit_per_visitor",
  "add_to_cart_rate",
  "reached_checkout_rate",
];

/**
 * Metrics carried as `Money` (`{amount, currency}`), not bare numbers. Which
 * metrics are money is fixed by the contract, so you can rely on it per field
 * rather than sniffing the value.
 */
export const MONEY_METRICS = [
  "revenue_per_visitor",
  "average_order_value",
  "profit_per_visitor",
  "revenue",
];

/**
 * An API error. Every ABConvert error carries the same envelope:
 * `{"error": {"type", "code", "message", "param", "details", "findings"}}`.
 */
export class AbconvertApiError extends Error {
  constructor(status, envelope) {
    const error = envelope?.error ?? {};
    super(error.message || `ABConvert API returned ${status}`);
    this.name = "AbconvertApiError";
    this.status = status;
    this.type = error.type ?? null;
    this.code = error.code ?? null;
    this.param = error.param ?? null;
    this.details = error.details ?? null;
    this.findings = error.findings ?? [];
    // Every 5xx carries a request_id. Quote it when you contact support.
    this.requestId = error.request_id ?? null;
  }

  /** One line per blocking finding, for logs and Slack messages. */
  describe() {
    let head = `${this.status} ${this.type ?? "error"}/${this.code ?? "unknown"}: ${this.message}`;
    if (this.requestId) head += ` (request_id: ${this.requestId})`;
    if (!this.findings.length) return head;
    const lines = this.findings.map(
      (f) => `  - [${f.severity}] ${f.code}${f.param ? ` (${f.param})` : ""}: ${f.message}`,
    );
    return [head, ...lines].join("\n");
  }
}

/** Show the last 4 characters of a token and nothing else. */
export function redactToken(token) {
  if (!token) return "(none)";
  return `${"*".repeat(8)}${String(token).slice(-4)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * Create a client bound to one shop's token.
 *
 * A token reaches exactly one shop. To work across stores, create one client
 * per store token.
 *
 * @param {object} options
 * @param {string} options.token   Bearer token.
 * @param {string} [options.base]  Base URL, default https://api.abconvert.io/v1
 * @param {number} [options.maxRetries] Retries for 429 and 5xx. Default 3.
 * @param {number} [options.timeoutMs]  Per-request timeout. Default 30000.
 */
export function createClient({
  token,
  base = process.env.ABCONVERT_API_BASE || DEFAULT_API_BASE,
  maxRetries = 3,
  timeoutMs = 30_000,
} = {}) {
  if (!token) {
    throw new Error("Set ABCONVERT_API_TOKEN, or pass a token to createClient().");
  }
  const origin = base.replace(/\/+$/, "");

  /**
   * One HTTP call. Retries on 429 and 5xx, and, when the request sent an
   * `Idempotency-Key`, on a 409 `idempotency_key_in_use` (the in-flight and
   * crashed cases clear within 90 seconds). Returns `{status, headers, body}`.
   * Throws AbconvertApiError on 4xx that retrying cannot fix; a 429 or 5xx
   * that outlasts the retry budget throws identically.
   */
  async function request(method, path, { query, body, idempotencyKey } = {}) {
    const url = `${origin}${path}${buildQuery(query)}`;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      // A 202 from GET /results carries no body; a 202 from POST /exports
      // carries the job.
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      // A 409 idempotency_key_in_use on a keyed request means the first
      // attempt is still running or crashed before recording its response;
      // both clear within 90 seconds. Any other 409 is terminal.
      const keyInUse =
        response.status === 409 &&
        Boolean(idempotencyKey) &&
        parsed?.error?.code === "idempotency_key_in_use";
      const retryable = response.status === 429 || response.status >= 500 || keyInUse;
      if (retryable && attempt < maxRetries) {
        // A 429 and the retryable 503s carry Retry-After, in seconds. Honor
        // it: never busy-loop writes.
        const retryAfter = Number(response.headers.get("Retry-After"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** attempt * 1000, 30_000);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new AbconvertApiError(response.status, parsed ?? { error: { message: text } });
      }

      return { status: response.status, headers: response.headers, body: parsed };
    }
  }

  return {
    base: origin,
    request,

    /** GET /experiments. One page. */
    async listExperiments(query = {}) {
      const { body } = await request("GET", "/experiments", { query });
      return body;
    },

    /**
     * GET /experiments, every page.
     * Filters: `status`, `type`, `created_at[gte]`, `created_at[lte]`, `scheduled`.
     * Pass `include: "results_summary"` to inline each test's fixed results
     * summary and save a read per test.
     * List rows carry test group identity only, never `changes`.
     */
    async listAllExperiments(query = {}) {
      const all = [];
      let cursor;
      do {
        const { body } = await request("GET", "/experiments", {
          query: { ...query, limit: query.limit ?? 100, cursor },
        });
        all.push(...body.data);
        cursor = body.has_more ? body.next_cursor : undefined;
      } while (cursor);
      return all;
    },

    /**
     * GET /experiments/{id}. Carries the full `changes` on every test group.
     * `include: "results_summary"` inlines the same fixed summary the list
     * endpoint offers.
     */
    async getExperiment(id, { include } = {}) {
      const { body } = await request("GET", `/experiments/${encodeURIComponent(id)}`, {
        query: { include },
      });
      return body;
    },

    /**
     * GET /experiments/{id}/results.
     * Returns the snapshot, or `null` when the API answers 202 because the
     * pipeline has not computed one yet. On a 202, poll again: the response's
     * `Retry-After` header says how many seconds to wait.
     *
     * @param {string} id
     * @param {object} [options]
     * @param {"date"} [options.breakdown] `date` is the only breakdown in v1.
     */
    async getResults(id, { breakdown } = {}) {
      const { status, body } = await request("GET", `/experiments/${encodeURIComponent(id)}/results`, {
        query: { breakdown },
      });
      return status === 202 ? null : body;
    },

    /** POST /experiments/{id}/pause. Already paused answers 200 and changes nothing. */
    async pauseExperiment(id) {
      const { body } = await request("POST", `/experiments/${encodeURIComponent(id)}/pause`);
      return body;
    },

    /** POST /experiments/{id}/resume. */
    async resumeExperiment(id) {
      const { body } = await request("POST", `/experiments/${encodeURIComponent(id)}/resume`);
      return body;
    },

    /**
     * POST /experiments/{id}/exports. Answers 202 with the job.
     *
     * Both `date_range` bounds are required and inclusive, and both are
     * calendar days in the store's timezone (`2026-08-01`), not timestamps.
     * `sampleBasis` picks the denominator: `assignment` (default) counts every
     * visitor put in a test group, `exposure` only those the test reached.
     *
     * An `Idempotency-Key` is always sent; one is generated when you don't
     * pass your own. Every retry attempt replays the same key, and a 5xx
     * releases the key per the contract, so the retry runs safely without
     * creating a duplicate job.
     */
    async createExport(id, dateRange, { idempotencyKey, sampleBasis } = {}) {
      idempotencyKey = idempotencyKey ?? randomUUID();
      const payload = { date_range: dateRange };
      if (sampleBasis) payload.sample_basis = sampleBasis;
      const { body } = await request("POST", `/experiments/${encodeURIComponent(id)}/exports`, {
        body: payload,
        idempotencyKey,
      });
      return body;
    },

    /** GET /exports/{id}. */
    async getExport(jobId) {
      const { body } = await request("GET", `/exports/${encodeURIComponent(jobId)}`);
      return body;
    },
  };
}

/** Build a client from the environment. Every example starts here. */
export function clientFromEnv(env = process.env) {
  return createClient({
    token: env.ABCONVERT_API_TOKEN,
    base: env.ABCONVERT_API_BASE,
  });
}

/**
 * Print a top-level `warnings` array. A 2xx that carries warnings is not a
 * clean pass, so never drop these.
 */
export function reportWarnings(label, payload) {
  const warnings = payload?.warnings ?? [];
  for (const warning of warnings) {
    console.warn(`[warning] ${label}: ${warning.code}${warning.param ? ` (${warning.param})` : ""} - ${warning.message}`);
  }
  return warnings;
}

/** Test group names live on the test, not on the results snapshot. */
export function testGroupNames(experiment) {
  const names = new Map();
  (experiment?.test_groups ?? []).forEach((group, index) => {
    names.set(index, group.name ?? `Test group ${index}`);
  });
  return names;
}

/** Percentages read better than the raw ratio the API returns for `lift`. */
export function formatLift(lift) {
  if (lift === null || lift === undefined) return "n/a";
  const pct = lift * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Format a frequentist or Bayesian interval on `lift`. Both bounds are ratios. */
export function formatInterval(interval) {
  if (!interval) return null;
  const { lower, upper } = interval;
  if (lower === null || lower === undefined || upper === null || upper === undefined) return null;
  return `${formatLift(lower)} to ${formatLift(upper)}`;
}

/** True for the `Money` object `{amount, currency}`. */
export function isMoney(value) {
  return Boolean(value) && typeof value === "object" && typeof value.amount === "string";
}

/**
 * Format a `Quantity`: `Money` on a money-valued metric, a bare number on a
 * dimensionless one.
 *
 * `amount` is printed verbatim. These are measurements, not prices: a per
 * visitor difference or an expected loss is routinely sub-cent and publishes
 * more than two decimal places (`"0.004"`). Rounding to cents would turn a real
 * finding into `0.00`, so this never rounds and never multiplies.
 */
export function formatQuantity(value, { rate = false, signed = false } = {}) {
  if (value === null || value === undefined) return "n/a";
  if (isMoney(value)) {
    const negative = value.amount.startsWith("-");
    const digits = negative ? value.amount.slice(1) : value.amount;
    const sign = negative ? "-" : signed ? "+" : "";
    return `${sign}${digits} ${value.currency}`;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const sign = value >= 0 && signed ? "+" : "";
  if (rate) return `${sign}${(value * 100).toFixed(2)}%`;
  return `${sign}${value}`;
}

/**
 * A `Quantity` as a JavaScript number, for sorting and threshold checks only.
 *
 * Never format from this. `Number("0.004")` is exact enough to rank two
 * results against each other, but printing a float re-introduces the rounding
 * `formatQuantity` exists to avoid.
 */
export function quantityToNumber(value) {
  if (value === null || value === undefined) return null;
  if (isMoney(value)) {
    const parsed = Number(value.amount);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Format a `difference_interval`, whose bounds are in the metric's own unit. */
export function formatQuantityInterval(interval, options) {
  if (!interval) return null;
  const { lower, upper } = interval;
  if (lower === null || lower === undefined || upper === null || upper === undefined) return null;
  return `${formatQuantity(lower, options)} to ${formatQuantity(upper, options)}`;
}

/**
 * One readable line for a `vs_control` metric comparison.
 *
 * `lift` is null in two cases the contract names: Control's value is zero, or
 * Control and this test group sit on strictly opposite sides of zero (reachable
 * on `profit_per_visitor`, which goes negative when costs exceed revenue).
 * `confidence_interval` and `credible_interval` bound `lift`, so both are null
 * wherever it is.
 *
 * `difference` is statable wherever `lift` is null, and null only when Control
 * or the test group has no value for the metric. `frequentist.difference_interval`
 * bounds it in the metric's own unit. So: quote the lift when there is one, and
 * fall back to the difference when there is not, rather than printing "n/a"
 * over a result that exists.
 */
export function describeComparison(comparison, { metric } = {}) {
  if (!comparison) return null;
  const rate = Boolean(metric) && !MONEY_METRICS.includes(metric);

  if (comparison.lift !== null && comparison.lift !== undefined) {
    const interval =
      formatInterval(comparison.frequentist?.confidence_interval) ??
      formatInterval(comparison.bayesian?.credible_interval);
    return interval ? `${formatLift(comparison.lift)} (${interval})` : formatLift(comparison.lift);
  }

  if (comparison.difference === null || comparison.difference === undefined) {
    return "no comparison against Control";
  }

  const interval = formatQuantityInterval(comparison.frequentist?.difference_interval, { rate, signed: true });
  const head = formatQuantity(comparison.difference, { rate, signed: true });
  const why = "no percentage: Control is zero, or the two sit on opposite sides of zero";
  return interval ? `${head} (${interval}; ${why})` : `${head} (${why})`;
}

/**
 * A sortable number for one comparison: `difference`, which every test group
 * carries and which is in the same unit for every group of the same test.
 *
 * Rank on the difference, not on `lift`. Sorting by lift drops every group
 * whose lift is null, and that is the group that crossed zero, the one that
 * moved most. `lift` is the fallback only where a snapshot stored no
 * difference at all.
 */
export function comparisonRank(comparison) {
  if (!comparison) return null;
  const difference = quantityToNumber(comparison.difference);
  if (difference !== null) return difference;
  return comparison.lift ?? null;
}

export { sleep };
