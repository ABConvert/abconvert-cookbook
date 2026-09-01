# ABConvert cookbook

Runnable recipes for the [ABConvert](https://abconvert.io) public REST API. Each example is one directory, one walkthrough, and one Node.js script you can read end to end in a few minutes.

ABConvert runs A/B tests on Shopify stores: price, shipping, theme, template, URL redirect, checkout, and offer tests. The API lets you create those tests, move them through their lifecycle, read results, and export order-level data from your own code. The contract lives in the [API reference](https://docs.abconvert.io/api-reference/overview). The examples here show how to use it.

## Start here

| | Example | What you learn |
|---|---|---|
| 1 | [`portfolio-dashboard`](examples/portfolio-dashboard/) | Read every store you hold a token for with `?include=results_summary` and create one HTML and Markdown dashboard. |
| 2 | [`order-export`](examples/order-export/) | Start an async order export, poll the job, download the CSV, and analyze it locally. |
| 3 | [`slack-report`](examples/slack-report/) | Find tests that hit day 7 or day 14, read a per-day breakdown, summarize with Claude, and post to a Slack webhook. |
| 4 | [`guardrail-monitor`](examples/guardrail-monitor/) | Poll every active test and pause one when a guardrail metric breaches your threshold. |

Every script imports [`lib/abconvert.mjs`](lib/abconvert.mjs), the shared client. It handles auth, pagination, the error envelope, rate-limit backoff, and results formatting.

## Ask an agent

You can also drive the API with an agent instead of a script. The hosted [MCP server](https://docs.abconvert.io/mcp/overview) is the fastest way to connect one. The [skill](skills/abconvert-public-api/) teaches an agent the REST API itself, the same endpoints these examples use.

### Claude Code

```bash
cp -r skills/abconvert-public-api ~/.claude/skills/
```

### Codex

```bash
cp -r skills/abconvert-public-api ~/.codex/skills/
```

### Cursor

```bash
cp -r skills/abconvert-public-api ~/.cursor/skills/
```

Then ask in plain language:

> "Create a 10% price test on my best-selling product, 50/50 split, run for 14 days."

> "Preview test 3021 and give me the preview link for each test group."

> "Launch test 3021. Tell me first what launching it will change and whether any other running test conflicts with it."

> "Summarize the results of test 3021 for a non-technical stakeholder. Lead with whether we should ship it."

> [!TIP]
> Connect your agent to your Shopify store as well ([shopify.com/build-with-ai](https://www.shopify.com/build-with-ai)). A prompt like "my best-selling product" needs store data the ABConvert API does not hold. With Shopify connected, the agent can look up products and orders and turn names into the product and product variant IDs the API takes.

Use a script for flows that run unattended. Use an agent for open-ended questions, where you want the reasoning next to the numbers.

## Get a token

1. Open the ABConvert admin.
2. Go to **Settings > MCP & API Access**.
3. Create a token and copy it. The plaintext is shown once.

A token reaches exactly one shop. New tokens default to read scope, which runs examples 1 to 3. Only the guardrail monitor needs write scope, to pause a test. [Authentication](https://docs.abconvert.io/api-reference/authentication) covers scopes.

> [!WARNING]
> Treat a token like a password: keep it in your secret manager, never in client-side code or a repository.

## Run your first example

```bash
git clone https://github.com/ABConvert/abconvert-cookbook.git
cd abconvert-cookbook
cp .env.example .env        # then put your token in it
set -a; source .env; set +a
node examples/portfolio-dashboard/dashboard.mjs
```

Node 20 or later. No dependencies, no build step, no framework.

Every script reads `ABCONVERT_API_TOKEN`. Each example's README lists the other variables it accepts.

## Before you write your own client

The [API overview](https://docs.abconvert.io/api-reference/overview) documents the error envelope, [rate limits](https://docs.abconvert.io/api-reference/overview#rate-limits), [idempotency](https://docs.abconvert.io/api-reference/overview#idempotency), and pagination. ABConvert does not send webhooks yet, so every recipe polls.

## Reference

- API reference and OpenAPI contract: <https://docs.abconvert.io/api-reference/overview>

## License

MIT. See [LICENSE](LICENSE).
