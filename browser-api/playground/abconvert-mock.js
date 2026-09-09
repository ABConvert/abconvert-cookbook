/**
 * A stand-in for the real `window.ABConvert`, for developing theme scripts
 * without a store.
 *
 * It behaves like the storefront runtime where the examples depend on it:
 *
 * - `window.ABConvertQueue` is adopted if your code created it, and every
 *   callback runs once, in order, after the document has finished parsing.
 *   After that, `push` runs a callback immediately.
 * - `abconvert:ready` fires on `window` at that same moment, once.
 * - `abconvert:assignment-ready` fires once per assignment, before ready, and
 *   never for a forced assignment.
 * - `?abconvert_force=EXPERIMENT_ID:INDEX` on the playground URL puts you in
 *   that test group for this tab, the way it does on a real storefront, and
 *   `forceTestGroup` / `clearForcedTestGroup` do the same from the console.
 *
 * The fixtures below are the objects the Browser API reference shows:
 * https://docs.abconvert.io/api-reference/browser-api
 *
 * Do not ship this file to a store. The app embed publishes the real object.
 */
(function () {
  // ---------------------------------------------------------------------------
  // Fixtures. Edit these to see the examples react.
  // ---------------------------------------------------------------------------

  var TESTS = {
    49603: {
      experimentName: 'Price test - Arc Performance Reformer',
      type: 'price',
      testGroups: [
        { index: 0, name: 'Control', control: true, split: 50 },
        { index: 1, name: 'Variant A - $49', control: false, split: 50 },
      ],
      // productId -> variantId -> group index -> price. Prices are set for the
      // US market only, so `getPriceByVariantId(id, { country: 'GB' })` is null.
      products: {
        6654464491584: {
          39586780971072: { 0: { amount: 60, compareAtAmount: null }, 1: { amount: 49, compareAtAmount: 60 } },
          39586780971073: { 0: { amount: 80, compareAtAmount: null }, 1: { amount: 69, compareAtAmount: 80 } },
        },
      },
      country: 'US',
      currency: 'USD',
    },
    50112: {
      experimentName: 'Shipping test - free shipping threshold',
      type: 'shipping',
      testGroups: [
        { index: 0, name: 'Control', control: true, split: 50 },
        { index: 1, name: 'Free over $75', control: false, split: 50 },
      ],
      // group index -> zone -> rates, cheapest first, as the API returns them.
      rates: {
        0: {
          'United States': [
            { name: 'Free shipping', amount: 0, currency: 'USD', condition: { type: 'price', minimum: 100, maximum: null, unit: null } },
            { name: 'Standard', amount: 5.99, currency: 'USD', condition: null },
          ],
          Canada: [
            { name: 'Standard', amount: 12.99, currency: 'CAD', condition: null },
          ],
        },
        1: {
          'United States': [
            { name: 'Free shipping', amount: 0, currency: 'USD', condition: { type: 'price', minimum: 75, maximum: null, unit: null } },
            { name: 'Standard', amount: 5.99, currency: 'USD', condition: null },
          ],
          Canada: [
            { name: 'Free shipping', amount: 0, currency: 'CAD', condition: { type: 'price', minimum: 120, maximum: null, unit: null } },
            { name: 'Standard', amount: 12.99, currency: 'CAD', condition: null },
          ],
        },
      },
    },
    50340: {
      experimentName: 'Offer test - volume discount',
      type: 'offer',
      testGroups: [
        { index: 0, name: 'Control', control: true, split: 50 },
        { index: 1, name: 'Buy 2 save 10%', control: false, split: 50 },
      ],
      // group index -> offer. Control has none.
      offers: {
        1: {
          title: 'Buy 2 save 10%',
          discounts: [
            {
              type: 'volume_discount',
              scope: { type: 'all_products' },
              tiers: [
                { threshold: 2, value: { unit: 'percentage', value: 10 } },
                { threshold: 4, value: { unit: 'percentage', value: 20 } },
              ],
            },
          ],
        },
      },
    },
  };

  // The test group the mock visitor lands in, per test, before any force.
  var DEFAULT_GROUP_INDEX = { 49603: 1, 50112: 1, 50340: 1 };

  // ---------------------------------------------------------------------------
  // Assignments, including `?abconvert_force=ID:INDEX` and forceTestGroup().
  // ---------------------------------------------------------------------------

  var FORCE_KEY = 'abconvert-mock-force:';

  function readForces() {
    var forces = {};
    try {
      Object.keys(window.sessionStorage).forEach(function (key) {
        if (key.indexOf(FORCE_KEY) === 0) forces[key.slice(FORCE_KEY.length)] = Number(sessionStorage.getItem(key));
      });
    } catch (error) { /* storage blocked: no forces */ }
    // Like the storefront script, read one abconvert_force value per URL. The
    // force is kept for the tab, so one URL per test forces several tests.
    var value = new URLSearchParams(window.location.search).get('abconvert_force');
    var parts = value ? value.split(':') : [];
    if (parts.length === 2) {
      forces[parts[0]] = Number(parts[1]);
      try { sessionStorage.setItem(FORCE_KEY + parts[0], parts[1]); } catch (error) { /* ignore */ }
    }
    return forces;
  }

  var forces = readForces();
  var assignments = {};
  Object.keys(TESTS).forEach(function (experimentId) {
    var test = TESTS[experimentId];
    var forced = Object.prototype.hasOwnProperty.call(forces, experimentId);
    var index = forced ? forces[experimentId] : DEFAULT_GROUP_INDEX[experimentId];
    var testGroup = test.testGroups[index];
    if (!testGroup) return;
    assignments[experimentId] = {
      experimentId: experimentId,
      experimentName: test.experimentName,
      type: test.type,
      status: 'active',
      testGroup: copy(testGroup),
      reason: forced ? 'url_force_assign' : 'random_split',
    };
  });

  function copy(object) { return JSON.parse(JSON.stringify(object)); }
  function assignmentFor(experimentId) { return assignments[String(experimentId)] || null; }

  // ---------------------------------------------------------------------------
  // The public object.
  // ---------------------------------------------------------------------------

  function priceFor(experimentId, productId, variantId, options) {
    var test = TESTS[experimentId];
    var assignment = assignmentFor(experimentId);
    if (!assignment) return null;
    var country = options && options.country ? String(options.country).toUpperCase() : test.country;
    // The test sets prices for one country. Any other country is a price the
    // store sets itself, which ABConvert does not know, so it reports nothing.
    if (country !== test.country) return null;
    var entry = test.products[productId][variantId][assignment.testGroup.index];
    return {
      experimentId: experimentId,
      testGroup: copy(assignment.testGroup),
      amount: entry.amount,
      compareAtAmount: entry.compareAtAmount,
      currency: test.currency,
      country: country,
      productId: String(productId),
      variantId: String(variantId),
    };
  }

  function findVariant(variantId) {
    var found = null;
    Object.keys(TESTS).forEach(function (experimentId) {
      var products = TESTS[experimentId].products || {};
      Object.keys(products).forEach(function (productId) {
        if (products[productId][variantId]) found = { experimentId: experimentId, productId: productId };
      });
    });
    return found;
  }

  function shippingAssignments() {
    return Object.keys(assignments)
      .filter(function (id) { return TESTS[id].type === 'shipping'; })
      .map(function (id) { return assignments[id]; });
  }

  var ABConvert = {
    onReady: function (callback) { window.ABConvertQueue.push(callback); },

    getAssignments: function () {
      return Object.keys(assignments).map(function (id) { return copy(assignments[id]); });
    },

    getAssignment: function (experimentId) {
      var assignment = assignmentFor(experimentId);
      return assignment ? copy(assignment) : null;
    },

    getPriceByVariantId: function (variantId, options) {
      var found = findVariant(String(variantId));
      return found ? priceFor(found.experimentId, found.productId, String(variantId), options) : null;
    },

    getPriceByProductId: function (productId, options) {
      var experimentId = null;
      Object.keys(TESTS).forEach(function (id) {
        if (TESTS[id].products && TESTS[id].products[productId]) experimentId = id;
      });
      if (!experimentId) return null;
      var variantIds = Object.keys(TESTS[experimentId].products[productId]);
      var prices = variantIds
        .map(function (variantId) { return priceFor(experimentId, productId, variantId, options); })
        .filter(Boolean);
      if (!prices.length) return null;
      var aggregate = (options && options.aggregate) || 'min';
      if (aggregate === 'first') return prices[0];
      return prices.reduce(function (best, price) {
        return (aggregate === 'max' ? price.amount > best.amount : price.amount < best.amount) ? price : best;
      });
    },

    formatPrice: function (amount, currency) {
      var active = currency || (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: active }).format(amount);
      } catch (error) {
        return active + ' ' + Number(amount).toFixed(2);
      }
    },

    getShippingRates: function (options) {
      var tests = shippingAssignments();
      if (!tests.length) return null;
      var wanted = options && options.zone;
      var rates = [];
      tests.forEach(function (assignment) {
        var zones = TESTS[assignment.experimentId].rates[assignment.testGroup.index] || {};
        Object.keys(zones).forEach(function (zone) {
          if (wanted != null && zone !== wanted) return;
          zones[zone].forEach(function (rate) {
            rates.push(Object.assign({ experimentId: assignment.experimentId, testGroup: copy(assignment.testGroup), zone: zone }, copy(rate)));
          });
        });
      });
      return rates;
    },

    getFreeShippingThreshold: function (options) {
      var rates = ABConvert.getShippingRates();
      if (rates === null) return null;
      var zones = [];
      rates.forEach(function (rate) { if (zones.indexOf(rate.zone) === -1) zones.push(rate.zone); });
      var wanted = (options && options.zone) || (zones.length === 1 ? zones[0] : null);
      if (wanted == null) return null;
      var free = rates.filter(function (rate) {
        return rate.zone === wanted && rate.amount === 0 && (!rate.condition || rate.condition.type === 'price');
      });
      if (!free.length) return null;
      var currencies = free.map(function (rate) { return rate.currency; }).filter(function (c, i, all) { return all.indexOf(c) === i; });
      if (currencies.length > 1) return null;
      var best = free.reduce(function (a, b) {
        return ((b.condition ? b.condition.minimum : 0) < (a.condition ? a.condition.minimum : 0)) ? b : a;
      });
      return {
        experimentId: best.experimentId,
        testGroup: best.testGroup,
        zone: wanted,
        amount: best.condition ? best.condition.minimum : 0,
        currency: best.currency,
      };
    },

    getOffers: function () {
      return Object.keys(assignments)
        .filter(function (id) { return TESTS[id].type === 'offer'; })
        .map(function (id) {
          var offer = TESTS[id].offers[assignments[id].testGroup.index];
          return offer && Object.assign({ experimentId: id, testGroup: copy(assignments[id].testGroup) }, copy(offer));
        })
        .filter(Boolean);
    },

    getVisitorId: function () { return 'mock-visitor'; },
    getCountry: function () { return 'US'; },

    forceTestGroup: function (experimentId, index) {
      try { sessionStorage.setItem(FORCE_KEY + experimentId, String(index)); } catch (error) { /* ignore */ }
    },
    clearForcedTestGroup: function (experimentId) {
      try { sessionStorage.removeItem(FORCE_KEY + experimentId); } catch (error) { /* ignore */ }
    },
  };

  // ---------------------------------------------------------------------------
  // Publish, then fire ready after parsing, the way the runtime does.
  // ---------------------------------------------------------------------------

  window.ABConvertQueue = window.ABConvertQueue || [];
  window.ABConvert = ABConvert;

  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: false, cancelable: false }));
  }

  function fireReady() {
    var queue = window.ABConvertQueue;
    Object.keys(assignments).forEach(function (id) {
      if (assignments[id].reason !== 'url_force_assign') dispatch('abconvert:assignment-ready', copy(assignments[id]));
    });
    queue.push = function () {
      Array.prototype.forEach.call(arguments, function (callback) { callback(ABConvert); });
      return queue.length;
    };
    queue.splice(0, queue.length).forEach(function (callback) { callback(ABConvert); });
    dispatch('abconvert:ready', ABConvert);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fireReady);
  else fireReady();
})();
