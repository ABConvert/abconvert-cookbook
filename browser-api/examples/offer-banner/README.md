# Offer banner

Announce the visitor's offer, with progress toward the next volume tier.

Script: [`offer-banner.js`](offer-banner.js)

<img src="screenshot.png" width="390" alt="A dark rounded card across the bottom of a mobile storefront reading Your offer, 30% off, with a Shop now button">

## Markup

```html
<div class="offer-banner" hidden>
  <strong class="offer-banner__title"></strong>
  <span class="offer-banner__progress"></span>
</div>
```

## What it does

1. Reads `getOffers()`. An empty list hides the banner; that is what Control with no offer sees.
2. Shows the first offer's title.
3. For a volume discount, reads the cart's item count from `GET /cart.js`, finds the tier the visitor has reached and the next one, and renders "You save 10%. Add 2 more items to save 20%", the wording the [docs example](https://docs.abconvert.io/api-reference/browser-api-examples#render-an-offer-banner) shows.
4. Re-renders when the cart changes.

ABConvert does not compute tier progress. `getOffers()` returns the offer's definition, in the same shape as the [public API's offer](https://docs.abconvert.io/api-reference/experiments/create-a-test), and the cart is yours to read.

## Adapting it

`discounts` can hold more than one discount, and each has a `type`: `product_discount`, `order_discount`, `shipping_discount`, `volume_discount`, or `threshold_discount`. The script handles the first offer and its volume tiers. For a threshold discount, compare `tiers[].threshold.amount` with the cart's `items_subtotal_price / 100` instead of `item_count`, and check `threshold.currency` against `cart.currency` first.

## Common mistakes

- **Showing the banner to Control.** Control with no offer gets `[]`. Hide the banner on an empty list.
- **Hard-coding the offer title.** Read `offer.title`. The merchant can change it, and the test can end.
- **Counting cart items the offer does not cover.** A `scope` of `specific_products` or `specific_collections` limits the discount. The playground offer covers all products; for a scoped offer, count only the matching cart lines.
