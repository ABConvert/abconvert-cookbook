/**
 * Send each ABConvert assignment to a data platform.
 *
 * Use this when the platform has no built-in ABConvert integration. GA4,
 * Segment, and the session recording tools on the Integrations page in the
 * ABConvert admin are already covered; turn those on instead of duplicating
 * their events from here.
 *
 * What it does:
 *   1. Waits for ABConvert to know the visitor's assignments.
 *   2. Sends one event per test the visitor is in, once per session.
 *
 * Pick a destination below, or add your own to DESTINATIONS.
 */
(function () {
  var DESTINATION = 'dataLayer';

  // Each destination receives one Assignment. Send `testGroup.index` as the
  // stable ID; the name is a label the merchant can rename mid-test.
  var DESTINATIONS = {
    // Google Tag Manager, or any tag that reads window.dataLayer. The event
    // name and `exp_variant_string` format match what other testing tools
    // push, so one GTM trigger can serve every tool.
    dataLayer: function (assignment) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'experience_impression',
        exp_variant_string: 'abconvert-' + assignment.experimentId + '-' + assignment.testGroup.index,
        experiment_id: assignment.experimentId,
        experiment_name: assignment.experimentName,
        variant_id: String(assignment.testGroup.index),
        variant_name: assignment.testGroup.name,
      });
    },

    // PostHog. `$feature_flag_called` with these two properties is what
    // PostHog's own experiment reports read.
    posthog: function (assignment) {
      if (!window.posthog) return;
      window.posthog.capture('$feature_flag_called', {
        $feature_flag: 'abconvert-' + assignment.experimentId,
        $feature_flag_response: String(assignment.testGroup.index),
        experiment_name: assignment.experimentName,
        variant_name: assignment.testGroup.name,
      });
    },

    // Mixpanel. `$experiment_started` with these two properties is what
    // Mixpanel's experiment reports read.
    mixpanel: function (assignment) {
      if (!window.mixpanel) return;
      window.mixpanel.track('$experiment_started', {
        'Experiment name': assignment.experimentName,
        'Variant name': assignment.testGroup.name,
        experiment_id: assignment.experimentId,
        variation_id: String(assignment.testGroup.index),
      });
    },
  };

  // Once per session per test group. Every page view would otherwise send
  // the same assignment again and inflate the platform's exposure counts.
  // Delete this and the check below to send on every page view instead.
  function markSent(assignment) {
    var key = 'abconvert-sent:' + assignment.experimentId + ':' + assignment.testGroup.index;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch (error) {
      // Storage blocked: send every page view rather than never.
    }
    return true;
  }

  function send(assignment) {
    // A forced or preview visit is excluded from ABConvert's results, so keep
    // it out of the platform's, too.
    if (assignment.reason === 'url_force_assign' || assignment.reason === 'preview_override') return;
    if (!markSent(assignment)) return;
    DESTINATIONS[DESTINATION](assignment);
  }

  window.ABConvertQueue = window.ABConvertQueue || [];
  window.ABConvertQueue.push(function (ABConvert) {
    ABConvert.getAssignments().forEach(send);
  });
})();
