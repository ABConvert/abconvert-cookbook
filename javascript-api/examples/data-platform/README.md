# Send assignments to a data platform

Use the JavaScript API to send one event per test the visitor is in to a platform that has no built-in ABConvert integration.

Script: [`assignments-to-data-platform.js`](assignments-to-data-platform.js)

## Before you use it

Check the Integrations page in the ABConvert admin first. GA4, Segment, and session recording tools are already covered there, and the built-in integrations send their events without theme code. Use this script for a platform that is not on that page, or for a tag manager that reads `window.dataLayer`.

## What it does

1. Waits for ABConvert to know the visitor's assignments, through `window.ABConvertQueue`.
2. Sends one event per assignment to the destination you picked.
3. Skips forced and preview visits, which ABConvert also excludes from results.
4. Sends each test group once per session, using `sessionStorage`. Remove that check to send on every page view.

If your tag manager wants a DOM event per assignment instead of a data layer push, listen for `abconvert:assignment-ready` at the top level of your script; the [reference](https://docs.abconvert.io/api-reference/browser-api-reference#events) describes when it fires.

## Setup

Set `DESTINATION` at the top of the script to one of the keys in `DESTINATIONS`:

| Destination | Sends |
|---|---|
| `dataLayer` | `experience_impression` with `exp_variant_string`, `experiment_id`, `experiment_name`, `variant_id`, `variant_name` |
| `posthog` | `$feature_flag_called` with `$feature_flag` set to `abconvert-<test ID>` and `$feature_flag_response` set to `control` or the test group index |
| `mixpanel` | `$experiment_started` with `Experiment name` and `Variant name` set to `control` or the test group index |

For PostHog, create an [experiment](https://posthog.com/docs/experiments/running-experiments-without-feature-flags) with the flag key `abconvert-<test ID>` and the variant keys `control`, `1`, `2`, and so on, one per test group. Mixpanel needs no setup; its [Experiments report](https://docs.mixpanel.com/docs/experiments) reads the event as is.

Both platforms treat this event as an exposure: the moment the visitor sees the tested page. ABConvert reports the assignment, which can come earlier, so a visitor can count as exposed before reaching the tested page.

To add a platform, add a function to `DESTINATIONS` that takes one `Assignment` and calls the platform's SDK. Send `testGroup.index` as the stable ID. `testGroup.name` is a label you can rename while the test runs.

## Common mistakes

- **Sending the test group name as the ID.** You can rename a test group while the test runs, and a renamed test group splits into two rows in the platform's report. Send `testGroup.index`.
- **Sending on every page view without meaning to.** Each assignment repeats on every page the visitor opens. Keep the once-per-session check unless your platform counts each visitor once itself.
- **Polling for `window.ABConvert` with a timer.** Push onto `window.ABConvertQueue` instead. It runs your callback whether ABConvert is ready before or after your script.
