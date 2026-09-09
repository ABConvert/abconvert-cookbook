/**
 * Show the visitor's test price in elements ABConvert does not rewrite: a
 * promo block, a bundle builder, a quick-view card, a "From $X" collection
 * card you render yourself.
 *
 * Markup. One product variant:
 *
 *   <span class="custom-price" data-variant-id="39586780971072">$60.00</span>
 *
 * A product's lowest price, for "From $X":
 *
 *   <span class="custom-price" data-product-id="6654464491584">From $60.00</span>
 *
 * The theme's own price stays in the element as the fallback. This script
 * rewrites it only for a visitor ABConvert gave a test price.
 *
 * What it does:
 *   1. Finds every marked element and asks ABConvert for its price.
 *   2. Renders the price, and the compare-at price when there is one.
 *   3. Watches the page and re-runs when it changes: product variant
 *      switches, Ajax collection filters, cart drawers, lazy-loaded cards.
 */
(function () {
  var SELECTOR = '.custom-price[data-variant-id], .custom-price[data-product-id]';

  function priceFor(ABConvert, element) {
    if (element.dataset.variantId) {
      return ABConvert.getPriceByVariantId ? ABConvert.getPriceByVariantId(element.dataset.variantId) : null;
    }
    // 'min' is the default. Pass { aggregate: 'max' } for the highest.
    return ABConvert.getPriceByProductId ? ABConvert.getPriceByProductId(element.dataset.productId) : null;
  }

  function markup(ABConvert, element, price) {
    var prefix = element.dataset.productId ? 'From ' : '';
    var current = '<span class="custom-price__current">' + ABConvert.formatPrice(price.amount, price.currency) + '</span>';
    var compareAt = price.compareAtAmount
      ? '<s class="custom-price__compare-at">' + ABConvert.formatPrice(price.compareAtAmount, price.currency) + '</s> '
      : '';
    return prefix + compareAt + current;
  }

  function apply(ABConvert) {
    document.querySelectorAll(SELECTOR).forEach(function (element) {
      var price = priceFor(ABConvert, element);
      // null: no test covers this product, the visitor is not in it, or the
      // test sets no price for their country. Leave the theme's price alone.
      if (!price) return;
      var html = markup(ABConvert, element, price);
      // Write only when it changed. ABConvert watches the page, and a rewrite
      // of an unchanged element would trigger it, then this, in a loop.
      if (element.innerHTML !== html) element.innerHTML = html;
    });
  }

  function watch(ABConvert) {
    apply(ABConvert);
    // One pass per animation frame, however many mutations arrive.
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        apply(ABConvert);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.ABConvertQueue = window.ABConvertQueue || [];
  window.ABConvertQueue.push(watch);
})();
