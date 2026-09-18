# ABConvert cookbook

Runnable examples for building on [ABConvert](https://abconvert.io), the A/B testing app for Shopify stores. Each example is one directory, one README, and one file you can read end to end in a few minutes.

ABConvert exposes two surfaces, and this repo has a section for each:

| Surface | What it is | Use it for | Start at |
|---|---|---|---|
| [REST API](rest-api/) | `api.abconvert.io/v1` | Creating tests, running their lifecycle, reading results, exporting orders, from your own backend or an agent | [`rest-api/README.md`](rest-api/README.md) |
| [JavaScript API](javascript-api/) | `window.ABConvert` on every storefront page | Sending assignments to your analytics tools, and showing a test price, a free shipping bar, or an offer banner, from theme JavaScript | [`javascript-api/README.md`](javascript-api/README.md) |

A headless SDK, for storefronts that do not run the Shopify theme, is planned. It will get its own top-level directory when it ships.

## Pick a section

**You write backend code or automation.** Go to [`rest-api/`](rest-api/). The examples read results into a dashboard, export orders, post a Slack report, and pause a test on a guardrail breach. They run on Node 20 with no dependencies.

**You write theme code.** Go to [`javascript-api/`](javascript-api/). Use the JavaScript API to send assignments to your analytics tools, show a test price, show a free shipping bar, and show an offer banner. The examples run in the browser, and a playground lets you try them without a store.

**You drive ABConvert with an agent.** The [skill](skills/abconvert-rest-api/) teaches Claude Code, Codex, or Cursor the REST API. [`rest-api/README.md`](rest-api/README.md#ask-an-agent) shows the setup and prompts.

## Layout

```
rest-api/        REST API examples and the shared Node client
javascript-api/  Storefront JavaScript examples and a playground
skills/          Agent skills, one per surface that has one
```

Each surface directory is self-contained: its README, its examples, and anything they share. Adding a surface means adding a directory here and a row to the table above.

## Reference

- [REST API reference](https://docs.abconvert.io/api-reference/overview)
- [JavaScript API reference](https://docs.abconvert.io/api-reference/browser-api)
- [ABConvert docs](https://docs.abconvert.io)

## License

MIT. See [LICENSE](LICENSE).
