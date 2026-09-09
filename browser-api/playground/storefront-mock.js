/**
 * The pieces of a Shopify storefront the examples touch, faked for the
 * playground: `window.Shopify`, `GET /cart.js`, and the
 * `shopify:cart:lines-update` event.
 *
 * The cart lives in memory. The buttons in index.html change it and dispatch
 * the same event a theme using `Shopify.actions.updateCart` would.
 */
(function () {
  window.Shopify = { routes: { root: '/' }, currency: { active: 'USD' } };

  var cart = { item_count: 1, items_subtotal_price: 4900, currency: 'USD' };
  var UNIT_PRICE_CENTS = 4900;

  function cartJson() {
    return new Response(JSON.stringify(cart), { headers: { 'Content-Type': 'application/json' } });
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (/\/cart\.js(\?|$)/.test(url)) return Promise.resolve(cartJson());
    return realFetch(input, init);
  };

  function changeCart(delta) {
    var updated = new Promise(function (resolve) {
      setTimeout(function () {
        cart.item_count = Math.max(0, cart.item_count + delta);
        cart.items_subtotal_price = cart.item_count * UNIT_PRICE_CENTS;
        resolve(cart);
      }, 150);
    });
    // Shopify dispatches this when the update starts, with `event.promise`
    // settling once the cart has changed. Listeners wait on the promise.
    var event = new CustomEvent('shopify:cart:lines-update', { bubbles: true, detail: { source: 'playground' } });
    event.promise = updated;
    document.dispatchEvent(event);
    return updated;
  }

  window.playgroundCart = {
    add: function () { return changeCart(1); },
    remove: function () { return changeCart(-1); },
    read: function () { return cart; },
  };
})();
