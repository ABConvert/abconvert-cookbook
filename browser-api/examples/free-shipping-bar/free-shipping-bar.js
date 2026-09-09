/**
 * "Spend $X more for free shipping" bar that follows the visitor's shipping
 * test group.
 *
 * Markup, anywhere on the page. The inner elements are optional: with only the
 * outer div, the text goes straight into it.
 *
 *   <div class="shipping-bar" hidden>
 *     <span class="shipping-bar__text"></span>
 *     <span class="shipping-bar__track"></span>
 *   </div>
 *
 * On a test with more than one shipping zone, say which zone the bar is for:
 *
 *   <div class="shipping-bar" data-zone="United States" hidden></div>
 *
 * What it does:
 *   1. Reads the free shipping threshold for the visitor's test group.
 *   2. Reads the cart subtotal from Shopify's Ajax API.
 *   3. Renders the gap, and hides the bar when there is nothing to show.
 *   4. Re-renders when the cart changes.
 */
(function () {
  var SELECTOR = '.shipping-bar';

  async function render(ABConvert) {
    var bar = document.querySelector(SELECTOR);
    if (!bar) return;

    // null: not in a shipping test, no free rate, or a multi-zone test with no
    // data-zone. Hide the bar rather than show a number the visitor will not
    // get at checkout.
    var threshold = ABConvert.getFreeShippingThreshold
      ? ABConvert.getFreeShippingThreshold(bar.dataset.zone ? { zone: bar.dataset.zone } : undefined)
      : null;
    if (!threshold) {
      bar.hidden = true;
      return;
    }

    // Shopify returns the subtotal in cents, in the cart's presentment currency.
    var cart = await fetch(window.Shopify.routes.root + 'cart.js').then(function (response) {
      return response.json();
    });
    // A rate is set in one currency. A cart priced in another cannot be
    // compared against it without an exchange rate, so show nothing.
    if (cart.currency !== threshold.currency) {
      bar.hidden = true;
      return;
    }
    var subtotal = cart.items_subtotal_price / 100;

    var remaining = Math.max(0, threshold.amount - subtotal);
    var text = remaining > 0
      ? 'Spend ' + ABConvert.formatPrice(remaining, threshold.currency) + ' more for free shipping'
      : 'You have free shipping';
    // Write only when the text changed. ABConvert watches the page, and a
    // rewrite of an unchanged element would trigger it, then this, in a loop.
    var label = bar.querySelector('.shipping-bar__text') || bar;
    if (label.textContent !== text) label.textContent = text;
    // How far along the visitor is, for a progress track drawn in CSS:
    // .shipping-bar__track::after { width: var(--shipping-progress) }
    var progress = Math.min(100, Math.round((subtotal / threshold.amount) * 100)) + '%';
    if (bar.style.getPropertyValue('--shipping-progress') !== progress) bar.style.setProperty('--shipping-progress', progress);
    bar.hidden = false;
  }

  function rerender() {
    if (window.ABConvert) render(window.ABConvert);
  }

  // Shopify's Storefront Events API fires this when a cart update starts.
  // `event.promise` settles once the cart has changed.
  document.addEventListener('shopify:cart:lines-update', function (event) {
    (event.promise || Promise.resolve()).then(rerender);
  });

  // Themes that post to /cart/add.js themselves do not fire the event above.
  // Dawn publishes 'cart-update' through its pubsub helper instead.
  if (typeof window.subscribe === 'function') {
    window.subscribe('cart-update', rerender);
  }

  window.ABConvertQueue = window.ABConvertQueue || [];
  window.ABConvertQueue.push(render);
})();
