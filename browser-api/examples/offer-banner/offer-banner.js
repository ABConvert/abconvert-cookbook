/**
 * Announce the visitor's offer in your own banner, with the progress toward
 * the next volume tier.
 *
 * Markup:
 *
 *   <div class="offer-banner" hidden>
 *     <strong class="offer-banner__title"></strong>
 *     <span class="offer-banner__progress"></span>
 *   </div>
 *
 * What it does:
 *   1. Reads the visitor's offers. An empty list hides the banner, which is
 *      also what Control with no offer sees.
 *   2. Shows the first offer's title.
 *   3. For a volume discount, compares the cart's item count with the tiers
 *      and says how many more items unlock the next one. ABConvert does not
 *      compute tier progress; the cart is yours to read.
 *   4. Re-renders when the cart changes.
 */
(function () {
  var SELECTOR = '.offer-banner';

  function describe(ABConvert, value) {
    return value.unit === 'percentage'
      ? value.value + '%'
      : ABConvert.formatPrice(value.amount.amount, value.amount.currency);
  }

  // The volume tiers of an offer, lowest threshold first, or [] when the
  // offer is not a volume discount.
  function volumeTiers(offer) {
    var discount = offer.discounts.filter(function (d) { return d.type === 'volume_discount'; })[0];
    return discount ? discount.tiers.slice().sort(function (a, b) { return a.threshold - b.threshold; }) : [];
  }

  function progressText(ABConvert, tiers, itemCount) {
    var next = tiers.filter(function (tier) { return tier.threshold > itemCount; })[0];
    var reached = tiers.filter(function (tier) { return tier.threshold <= itemCount; }).pop();
    var parts = [];
    if (reached) parts.push('You save ' + describe(ABConvert, reached.value));
    if (next) {
      var more = next.threshold - itemCount;
      parts.push('Add ' + more + ' more ' + (more === 1 ? 'item' : 'items') + ' to save ' + describe(ABConvert, next.value));
    }
    return parts.join('. ');
  }

  async function render(ABConvert) {
    var banner = document.querySelector(SELECTOR);
    if (!banner) return;

    var offer = ABConvert.getOffers ? ABConvert.getOffers()[0] : undefined;
    if (!offer) {
      banner.hidden = true;
      return;
    }

    var title = banner.querySelector('.offer-banner__title');
    var progress = banner.querySelector('.offer-banner__progress');
    if (title && title.textContent !== offer.title) title.textContent = offer.title;

    var tiers = volumeTiers(offer);
    if (progress && tiers.length) {
      var cart = await fetch(window.Shopify.routes.root + 'cart.js').then(function (response) {
        return response.json();
      });
      var text = progressText(ABConvert, tiers, cart.item_count);
      // Write only when the text changed, so ABConvert's own page watcher and
      // this script never trigger each other.
      if (progress.textContent !== text) progress.textContent = text;
    }
    banner.hidden = false;
  }

  function rerender() {
    if (window.ABConvert) render(window.ABConvert);
  }

  document.addEventListener('shopify:cart:lines-update', function (event) {
    (event.promise || Promise.resolve()).then(rerender);
  });
  if (typeof window.subscribe === 'function') {
    window.subscribe('cart-update', rerender);
  }

  window.ABConvertQueue = window.ABConvertQueue || [];
  window.ABConvertQueue.push(render);
})();
