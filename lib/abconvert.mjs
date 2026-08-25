/**
 * Minimal ABConvert Public API client.
 *
 * Node 20+, no dependencies, `fetch` only. Every example in this repo imports
 * this file, so the error envelope, pagination, and rate-limit handling are
 * written once.
 *
 * Contract: https://api.abconvert.io/v1 (see external-docs/api-reference/openapi.yaml
 * in the ABConvert repo, or the published API reference).
 */

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
  }

  /** One line per blocking finding, for logs and Slack messages. */
  describe() {
    const head = `${this.status} ${this.type ?? "error"}/${this.code ?? "unknown"}: ${this.message}`;
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
 * @param {string} options.token   Bearer token. New tokens start with `abcv_live_`.
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
   * One HTTP call, with retries on 429 and 5xx.
   * Returns `{status, headers, body}`. Throws AbconvertApiError on 4xx that
   * retrying cannot fix, and on a 429 that outlasts the retry budget.
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

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        // A 429 always carries Retry-After, in seconds. Honor it: never busy-loop writes.
        const retryAfter = Number(response.headers.get("Retry-After"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** attempt * 1000, 30_000);
        await response.body?.cancel();
        await sleep(waitMs);
        continue;
      }

      // 202 responses carry no body: an export job accepted, or results with no
      // snapshot computed yet.
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
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

    /** GET /experiments/{id}. Carries the full `changes` on every test group. */
    async getExperiment(id) {
      const { body } = await request("GET", `/experiments/${encodeURIComponent(id)}`);
      return body;
    },

    /**
     * GET /experiments/{id}/results.
     * Returns the snapshot, or `null` when the API answers 202 because the
     * pipeline has not computed one yet.
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
     * Both `date_range` bounds are required and inclusive.
     */
    async createExport(id, dateRange, { idempotencyKey } = {}) {
      const { body } = await request("POST", `/experiments/${encodeURIComponent(id)}/exports`, {
        body: { date_range: dateRange },
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
    base: env.ABCONVERT_API_BASE || DEFAULT_API_BASE,
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

/** Format a frequentist or Bayesian interval on `lift`. */
export function formatInterval(interval) {
  if (!interval) return null;
  const { lower, upper } = interval;
  if (lower === undefined || upper === undefined) return null;
  return `${formatLift(lower)} to ${formatLift(upper)}`;
}

export { sleep };
