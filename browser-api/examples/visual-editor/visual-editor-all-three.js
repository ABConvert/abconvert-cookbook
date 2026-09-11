/**
 * All three storefront examples, run from a visual editor test's custom
 * JavaScript instead of the theme: the free shipping bar, a bundle block with
 * test prices, and the offer banner.
 *
 * Verified on a Dawn storefront, 2026-09-11. Four things this script does that
 * a theme script does not need to, each learned the hard way:
 *
 *   1. Custom JavaScript is injected into <head> before the page has a <body>.
 *      Every element is created inside the first window.ABConvertQueue callback,
 *      which runs once the document has parsed. Callbacks run in push order,
 *      so that builder runs before the example callbacks that render into it.
 *   2. The bundle anchors on the product's own price container, never on the
 *      first `.price` on the page: with an item in the cart, Dawn renders the
 *      cart drawer's line-item price earlier in the DOM, inside a hidden drawer.
 *   3. The bundle is built on product pages only. Elsewhere the first price
 *      belongs to a card and the block would land inside a grid.
 *   4. Cart changes are watched three ways, because themes differ in what they
 *      emit. See free-shipping-bar.js for the reasoning.
 *
 * Set the two product variant IDs below to variants covered by a running price
 * test. The fallback prices in the markup are what visitors outside the test see.
 */
(function () {
  var css = document.createElement('style');
  css.textContent = [
    '.shipping-bar{position:sticky;top:0;z-index:9999;background:#eef5e6;color:#1f2a17;padding:9px 16px 8px;font:500 13px/1.3 -apple-system,system-ui,sans-serif;text-align:center}',
    '.shipping-bar__text{display:block;margin-bottom:6px}',
    '.shipping-bar__track{display:block;height:5px;border-radius:3px;background:rgba(0,0,0,.12);overflow:hidden}',
    '.shipping-bar__track::after{content:"";display:block;height:100%;width:var(--shipping-progress,0%);background:#7ba44b;border-radius:3px;transition:width .3s}',
    '.bundle{border:1px solid #d9d9d9;border-radius:12px;padding:13px 15px;margin:16px 0;max-width:420px;font:14px/1.45 -apple-system,system-ui,sans-serif;background:#fff}',
    '.bundle h3{margin:0 0 9px;font-size:15px;font-weight:700}',
    '.bundle__row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0}',
    '.bundle__row span:last-child{font-weight:600;white-space:nowrap}',
    '.custom-price{font-variant-numeric:tabular-nums}',
    /* bottom:64px keeps the banner above the bar Shopify shows staff on a password-protected store */
    '.offer-banner{position:fixed;left:12px;right:12px;bottom:64px;z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#141414;color:#fff;padding:11px 14px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.22);font:14px/1.3 -apple-system,system-ui,sans-serif;max-width:640px;margin:0 auto}',
    '.offer-banner__label{display:block;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#b9d08f;margin-bottom:2px}',
    '.offer-banner__title{font-size:16px;font-weight:700}',
    '.offer-banner__cta{flex:none;background:#fff;color:#141414;font-weight:600;font-size:13px;padding:8px 14px;border-radius:8px;text-decoration:none;cursor:pointer;display:inline-block}',
    '.offer-banner__cta:hover{background:#e8e8e8}',
  ].join('');
  // <head> exists when the Visual Editor injects this script, but not in every
  // harness, so fall back to inserting the stylesheet once the document opens.
  function addStyles() {
    var target = document.head || document.documentElement;
    if (!target) return false;
    target.appendChild(css);
    return true;
  }
  if (!addStyles()) document.addEventListener('DOMContentLoaded', addStyles);

  // ---- Set these for your store ------------------------------------------
  var WAX_VARIANT = '47522361606401';   // a product variant in a running price test
  var KIT_VARIANT = '47522361639169';   // another, or the same
  var WAX_FALLBACK = '$57.00';          // the catalog price, shown outside the test
  var KIT_FALLBACK = '$12.00';
  var SHOP_NOW_PATH = 'collections/all';
  // -------------------------------------------------------------------------

  // Pushed first, so it runs before the example callbacks below look for these
  // elements: the queue runs callbacks in the order they were pushed.
  window.ABConvertQueue = window.ABConvertQueue || [];
  window.ABConvertQueue.push(function () {
    var bar = document.createElement('div');
    bar.className = 'shipping-bar';
    bar.hidden = true;
    bar.innerHTML = '<span class="shipping-bar__text"></span><span class="shipping-bar__track"></span>';
    document.body.insertBefore(bar, document.body.firstChild);

    var banner = document.createElement('div');
    banner.className = 'offer-banner';
    banner.hidden = true;
    banner.innerHTML =
      '<div><span class="offer-banner__label">Your offer</span>' +
      '<span class="offer-banner__title"></span></div>' +
      '<a class="offer-banner__cta" href="' + (window.Shopify && window.Shopify.routes && window.Shopify.routes.root || '/') + SHOP_NOW_PATH + '">Shop now</a>';
    document.body.appendChild(banner);

    // The bundle block belongs to a product page only: on a collection page the
    // first `.price` is a card's, and the block would land inside the grid.
    if (location.pathname.indexOf('/products/') === -1) return;

    // It goes under the product price, the way a theme section would.
    var bundle = document.createElement('div');
    bundle.className = 'bundle';
    bundle.innerHTML =
      '<h3>Add the wax kit</h3>' +
      '<div class="bundle__row"><span>Special ski wax</span>' +
        '<span class="custom-price" data-variant-id="' + WAX_VARIANT + '">' + WAX_FALLBACK + '</span></div>' +
      '<div class="bundle__row"><span>Sample ski wax</span>' +
        '<span class="custom-price" data-variant-id="' + KIT_VARIANT + '">' + KIT_FALLBACK + '</span></div>';
    // Anchor on the product's own price, never the first `.price` on the page:
    // with an item in the cart, Dawn renders the cart drawer's line-item price
    // earlier in the DOM, inside a drawer that is hidden until opened.
    var anchor = document.querySelector('product-info .price, .product__info-container .price, .product__info-wrapper .price');
    if (!anchor) {
      var prices = document.querySelectorAll('.price');
      for (var i = 0; i < prices.length; i++) {
        if (prices[i].offsetParent !== null && !prices[i].closest('cart-drawer, .cart-drawer, [class*="drawer"]')) { anchor = prices[i]; break; }
      }
    }
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(bundle, anchor.nextSibling);
    } else {
      document.body.appendChild(bundle);
    }

  });

  // ---- Example 1: render a custom price element -------------------------
  window.ABConvertQueue.push(function (ABConvert) {
    function paint() {
      document.querySelectorAll('.custom-price[data-variant-id]').forEach(function (element) {
        var price = ABConvert.getPriceByVariantId && ABConvert.getPriceByVariantId(element.dataset.variantId);
        // null: the visitor is not in the test. Leave the theme's price alone.
        if (!price) return;
        var text = ABConvert.formatPrice(price.amount, price.currency);
        // Write only on change, or our write would wake ABConvert's observer,
        // which would wake this script, in a loop.
        if (element.textContent !== text) element.textContent = text;
      });
    }
    paint();
    // Product variant switches and cart drawers re-render the page.
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; paint(); });
    }).observe(document.body, { childList: true, subtree: true });
  });

  // ---- Example 2: free shipping progress bar ----------------------------
  async function renderShippingBar(ABConvert) {
    var bar = document.querySelector('.shipping-bar');
    if (!bar) return;
    var threshold = ABConvert.getFreeShippingThreshold && ABConvert.getFreeShippingThreshold();
    if (!threshold) { bar.hidden = true; return; }   // no shipping test, or no free rate

    var response = await fetch(window.Shopify.routes.root + 'cart.js');
    var cart = await response.json();
    if (cart.currency !== threshold.currency) {
      // Cannot compare across currencies. Say so rather than vanishing, so the
      // demo explains itself when the storefront is in another market.
      var t = bar.querySelector('.shipping-bar__text') || bar;
      var msg = 'Free shipping threshold is in ' + threshold.currency
        + ', this market is in ' + cart.currency + '. Switch to United States to see the bar.';
      if (t.textContent !== msg) t.textContent = msg;
      bar.style.setProperty('--shipping-progress', '0%');
      bar.hidden = false;
      return;
    }
    var subtotal = cart.items_subtotal_price / 100;   // Shopify returns cents

    var remaining = Math.max(0, threshold.amount - subtotal);
    var text = remaining > 0
      ? 'Spend ' + ABConvert.formatPrice(remaining, threshold.currency) + ' more for free shipping'
      : 'You have free shipping';
    var target = bar.querySelector('.shipping-bar__text') || bar;
    if (target.textContent !== text) target.textContent = text;
    var pct = threshold.amount > 0 ? Math.min(100, (subtotal / threshold.amount) * 100) : 100;
    bar.style.setProperty('--shipping-progress', pct.toFixed(1) + '%');
    bar.hidden = false;
  }

  // ---- Example 3: offer banner -----------------------------------------
  function renderOfferBanner(ABConvert) {
    var offer = (ABConvert.getOffers && ABConvert.getOffers() || [])[0];
    var banner = document.querySelector('.offer-banner');
    if (!banner) return;
    if (!offer) { banner.hidden = true; return; }
    var title = banner.querySelector('.offer-banner__title') || banner;
    if (title.textContent !== offer.title) title.textContent = offer.title;
    banner.hidden = false;
  }

  function render(ABConvert) {
    renderShippingBar(ABConvert).catch(function () { /* leave the bar hidden */ });
    renderOfferBanner(ABConvert);
  }
  var pending = null;
  function rerender() {
    // Several signals can land for one cart change; collapse them into one pass.
    clearTimeout(pending);
    pending = setTimeout(function () {
      if (window.ABConvert) render(window.ABConvert);
    }, 120);
  }

  // Themes differ in what they emit on a cart change, so watch every signal.
  // 1. The Storefront Events API, for themes that use Shopify.actions.updateCart.
  document.addEventListener('shopify:cart:lines-update', function (event) {
    (event.promise || Promise.resolve()).then(rerender);
  });

  // 2. The cart write itself, which is the one signal every theme produces.
  //    Dawn posts straight to /cart/add and /cart/change.js and fires neither
  //    the Shopify event nor anything this script can subscribe to in time.
  var CART_WRITE = /\/cart\/(add|change|update|clear)(\.js)?($|\?)/;

  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input) {
      var url = (input && input.url) || input;
      var result = nativeFetch.apply(this, arguments);
      // Hand the theme back its own promise; only watch it from the side.
      if (typeof url === 'string' && CART_WRITE.test(url)) result.then(rerender, function () {});
      return result;
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && CART_WRITE.test(url)) this.addEventListener('load', rerender);
    return nativeOpen.apply(this, arguments);
  };

  window.ABConvertQueue.push(function (ABConvert) {
    // 3. The theme's own pubsub, which only exists once the theme has loaded.
    //    Checking for it at inject time is too early: it is not defined yet.
    if (typeof window.subscribe === 'function') {
      try { window.subscribe('cart-update', rerender); } catch (e) { /* theme-specific */ }
    }
    render(ABConvert);
  });
})();
