# ABConvert cookbook

Runnable examples for building on [ABConvert](https://abconvert.io), the A/B testing app for Shopify stores.

| Surface | What it is | Use it for | Start at |
|---|---|---|---|
| [REST API](rest-api/) | `api.abconvert.io/v1` | Creating tests, running their lifecycle, reading results, exporting orders, from your own backend or an agent | [`rest-api/README.md`](rest-api/README.md) |
| [JavaScript API](javascript-api/) | `window.ABConvert` on every storefront page | Sending assignments to your analytics tools, and showing a test price, a free shipping bar, or an offer banner, from theme JavaScript | [`javascript-api/README.md`](javascript-api/README.md) |

To drive ABConvert with an agent instead, the [skill](skills/abconvert-rest-api/) teaches Claude Code, Codex, or Cursor the REST API; [`rest-api/README.md`](rest-api/README.md#ask-an-agent) shows the setup and prompts.

## Reference

- [REST API reference](https://docs.abconvert.io/api-reference/overview)
- [JavaScript API reference](https://docs.abconvert.io/api-reference/browser-api)
- [ABConvert docs](https://docs.abconvert.io)

## License

MIT. See [LICENSE](LICENSE).
