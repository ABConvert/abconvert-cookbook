# Free shipping progress bar

"Spend $25.00 more for free shipping", using the threshold of the visitor's shipping test group.

Script: [`free-shipping-bar.js`](free-shipping-bar.js)

## Markup

```html
<div class="shipping-bar" hidden></div>
```

On a test with more than one shipping zone, name the zone the bar is for. Shopify picks the zone at checkout from the shipping address, so the browser does not know it:

```html
<div class="shipping-bar" data-zone="United States" hidden></div>
```

## What it does

1. Reads `getFreeShippingThreshold()` for the visitor's test group.
2. Reads the cart subtotal from Shopify's Ajax API, `GET /cart.js`.
3. Renders the remaining amount, or "You have free shipping".
4. Hides the bar when there is nothing true to show: the visitor is not in a shipping test, the test group has no free rate, the zone is unknown, or the cart is priced in a different currency from the rate.
5. Re-renders on `shopify:cart:lines-update`, and on Dawn's `cart-update` for themes that update the cart without dispatching Shopify's event.

## Common mistakes

- **Showing a bar for visitors who are not in the test.** `getFreeShippingThreshold()` returns `null` for them. Hide the bar; your theme's own free shipping message, if any, still applies.
- **Comparing a rate in one currency with a cart in another.** A rate is set in one currency and ABConvert does not convert it. The script checks `cart.currency` against `threshold.currency` and hides the bar on a mismatch.
- **Reading the cart before the update finished.** `shopify:cart:lines-update` fires when the update starts. Wait on `event.promise`, as the script does.
- **Rewriting the bar on every cart event.** Write only when the text changed. ABConvert watches the page, and rewriting an unchanged element can trigger it and your script in a loop.
