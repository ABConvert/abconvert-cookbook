# ABConvert cookbook

Runnable examples for building on [ABConvert](https://abconvert.io), the A/B testing app for Shopify stores. Each example is one directory, one README, and one file you can read end to end in a few minutes.

ABConvert exposes two surfaces, and this repo has a section for each:

| Surface | What it is | Use it for | Start at |
|---|---|---|---|
| [Public API](public-api/) | REST API at `api.abconvert.io/v1` | Creating tests, running their lifecycle, reading results, exporting orders, from your own backend or an agent | [`public-api/README.md`](public-api/README.md) |
| [Browser API](browser-api/) | `window.ABConvert` on every storefront page | Reading the visitor's test group, price, shipping rates, and offer from theme JavaScript | [`browser-api/README.md`](browser-api/README.md) |

A headless SDK, for storefronts that do not run the Shopify theme, is planned. It will get its own top-level directory when it ships.

## Pick a section

**You write backend code or automation.** Go to [`public-api/`](public-api/). The examples read results into a dashboard, export orders, post a Slack report, and pause a test on a guardrail breach. They run on Node 20 with no dependencies.

**You write theme code.** Go to [`browser-api/`](browser-api/). The examples send assignments to a data platform, render a free shipping bar, rewrite a price element ABConvert does not reach, and render an offer banner. They run in the browser, and a playground lets you try them without a store.

**You drive ABConvert with an agent.** The [skill](skills/abconvert-public-api/) teaches Claude Code, Codex, or Cursor the REST API. [`public-api/README.md`](public-api/README.md#ask-an-agent) shows the setup and prompts.

## Layout

```
public-api/      REST API examples and the shared Node client
browser-api/     Storefront JavaScript examples and a playground
skills/          Agent skills, one per surface that has one
```

Each surface directory is self-contained: its README, its examples, and anything they share. Adding a surface means adding a directory here and a row to the table above.

## Reference

- [Public API reference](https://docs.abconvert.io/api-reference/overview)
- [Browser API reference](https://docs.abconvert.io/api-reference/browser-api)
- [ABConvert docs](https://docs.abconvert.io)

## License

MIT. See [LICENSE](LICENSE).
