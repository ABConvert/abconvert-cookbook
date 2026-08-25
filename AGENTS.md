# Ask Claude

Every recipe in this cookbook has an agent path. Instead of running the script, you hand an agent the skill and a prompt, and it drives the API for you.

The agent path is a first-class way to use this API, not a demo. The scripts are for the flows you want to run on a schedule; the prompts are for the ones you want to run once, or want to reason about while they run.

## Set up the skill

Copy the skill into your own agent's skill directory:

```bash
cp -r skills/abconvert-public-api ~/.claude/skills/
export ABCONVERT_API_TOKEN="abcv_live_..."
export ABCONVERT_API_BASE="https://api.abconvert.io/v1"
```

The skill teaches the agent the endpoints, the ID formats, the lifecycle rules, and which actions to stop and confirm before taking. It works in Claude Code, and in any agent that reads `SKILL.md`-style instructions.

## Prompts

Paste these as written.

### Create a test

> "Create a 10% price test on my best-selling product, 50/50 split, run for 14 days."

> "Set up a shipping test on my US zone: Control keeps free shipping over $50, Variant A drops the threshold to $35. Split it 50/50 and leave it in draft."

> "Create a URL redirect test that sends half of the traffic hitting /products/old-pdp to /products/new-pdp. Do not launch it."

### Preview before launching

> "Preview test 3021 and give me the preview link for each test group."

> "I want to see Variant B of test 3021 on the product page for the handle merino-crew before I launch anything."

### Launch, pause, and end

> "Launch test 3021. Tell me first what launching it will change and whether any other running test conflicts with it."

> "Pause every active price test on this store and tell me which ones you paused."

> "End test 3021 and give me the final numbers."

### Read results

> "Summarize the results of test 3021 for a non-technical stakeholder. Lead with whether we should ship it."

> "Show me the day-by-day breakdown for test 3021 and tell me whether the lift is stable or still moving."

> "Check test 3021 for a sample ratio mismatch and tell me whether the results are trustworthy."

### Cross-test and portfolio questions

> "List every test that has been running longer than 21 days and tell me which ones have enough traffic to call."

> "Across all my active tests, which one has the highest probability of beating Control on revenue per visitor?"

### Export and analyze

> "Export the order-level data for test 3021 for the last 30 days, download it, and tell me how average order value differs between the test groups."

## What the agent will stop and ask about

The skill instructs the agent to confirm before it does anything one-way or traffic-affecting:

- `start` puts real visitors into the test.
- `end` and `archive` cannot be undone.
- Changing a `split` on a running test reassigns visitors and dilutes the traffic already recorded.

Expect the agent to create a draft, preview it, hand you the preview links, and wait. Say so explicitly if you want it to launch in one step.

## When to use a script instead

Use a script when the flow runs unattended: a nightly report, an hourly guardrail check, a dashboard refresh. A scheduled agent run costs more than a `fetch` and gives you a different answer each time it runs, which is the wrong property for a monitor.

Use the agent when the question is open ended, when you want the reasoning alongside the numbers, or when you are exploring rather than operating.
