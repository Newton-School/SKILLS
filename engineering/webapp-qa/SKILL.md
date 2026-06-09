---
name: webapp-qa
description: Hybrid QA investigation for web applications. Use when a coding agent needs to test a feature or flow, reproduce or triage a browser bug, validate regressions, inspect failures with Playwright or browser diagnostics, or generate a QA report with scenario coverage, repro steps, evidence, and risk notes.
---

# Webapp QA

Use this skill to own QA intake, scenario design, browser investigation, and final reporting for web applications.

When the app is reachable and interactive, use the browser automation workflow available in the current agent environment. Prefer Playwright or an equivalent persistent browser session when available. Use this skill to decide what to test, what evidence to capture, when to investigate deeper, and how to report the result.

## Quick Start

1. Gather the missing context needed to test the feature safely.
2. Build a coverage matrix before touching the app.
3. Use Playwright or an available browser automation workflow when real browser execution is possible.
4. Capture baseline evidence for each executed scenario.
5. Escalate to browser diagnostics only when a scenario fails or looks suspicious.
6. Deliver the final report using `references/report-template.md`.

## Intake

Collect the minimum information required to produce a trustworthy report:

- feature or flow under test
- expected behavior and any explicit acceptance criteria
- target URL or environment
- credentials, roles, seed data, or setup dependencies
- browser, viewport, or device constraints
- known risk areas, regressions, or related surfaces

If any of the first four items are missing and cannot be discovered from the available project or environment context, ask for them before signoff.

If the app is unreachable, auth is missing, or test data is unavailable, continue only far enough to describe the blocker and the lost coverage. Do not claim execution that did not happen.

## Coverage Matrix

Build the matrix before executing scenarios. Every row must include the scenario, the intended status source, and the evidence you expect to capture.

Always consider these buckets and mark them as `Passed`, `Failed`, `Blocked`, or `Not Run`:

- happy path
- alternate path
- invalid input or validation
- loading state
- empty state
- error state
- refresh or back-navigation behavior
- auth or permission behavior
- responsive or mobile behavior when relevant
- accessibility smoke checks
- nearby regression touchpoints

Use `references/scenario-catalog.md` to expand the matrix for the specific feature shape.

## Execution Workflow

### 1. Decide execution mode

- If the app is reachable and the user wants real verification, use Playwright or the available browser automation workflow.
- If browser execution is impossible, reason about likely risks, ask for missing inputs if needed, and mark all unexecuted scenarios as `Blocked` or `Not Run`.
- Never mark a scenario as `Passed` unless it was actually executed and observed.

### 2. Run baseline QA

For each executed scenario, capture:

- scenario name
- status: `Passed`, `Failed`, or `Blocked`
- current URL, route, or relevant app state
- screenshots for the key visible state
- short note on what was exercised

Use real user interactions for signoff. Follow the functional and visual QA posture of the active Playwright or browser automation workflow.

### 3. Trigger deeper investigation

Escalate beyond baseline QA when:

- the scenario fails
- the UI looks wrong even if the flow completes
- behavior is flaky, inconsistent, or environment-sensitive
- the issue appears tied to network, state, auth, or accessibility

## Diagnostic Deep Dive

Use browser diagnostics selectively. Prefer the smallest set of checks that explains the failure.

### Always collect on suspicious or failing scenarios

- console warnings and errors
- uncaught page errors
- failed requests
- screenshot evidence of the bad state

### Add network inspection when the issue looks API-driven

- relevant request URL, method, status, and payload shape if observable
- whether the UI handled non-200 or malformed responses correctly
- timing or retry behavior only when it explains the bug

### Add DOM or state inspection when the UI and behavior disagree

- visible text, disabled state, selected state, or hidden state
- relevant element attributes or rendered values
- URL, query params, or route state when navigation is involved

### Add storage or session inspection only when plausible

- local storage
- session storage
- cookies
- persisted auth or feature-flag state

### Add accessibility inspection when the issue is semantic

- focus order or focus loss
- accessible name or label mismatch
- role, disabled state, or hidden semantics

Use `references/diagnostic-playbook.md` to choose the right evidence path. Do not perform full heavy diagnostics on every passing scenario.

## Reporting Rules

Always deliver a single QA report in markdown using `references/report-template.md`.

The report must include:

- `Feature Summary`
- `Environment`
- `Coverage Matrix`
- `Findings`
- `Blocked / Not Run`
- `Risk Assessment`

### Findings

Each confirmed issue must include:

- `ID`
- `Title`
- `Severity`
- `Scenario`
- `Preconditions`
- `Steps to Reproduce`
- `Expected Result`
- `Actual Result`
- `Evidence`
- `Likely Signal`
- `Notes / Suspected Root Cause`

Use evidence-backed language. Prefer screenshot references, console excerpts, failed request summaries, DOM observations, or storage mismatches over vague descriptions.

If you only suspect a problem and cannot confirm it, place it under open risks or notes instead of reporting it as a confirmed bug.

### Severity

- `P0`: core flow broken, severe data loss or security-like impact, or no viable workaround
- `P1`: user-visible incorrect behavior or likely regression in an important flow
- `P2`: medium-impact bug, degraded experience, or partial workflow issue
- `P3`: minor defect, polish issue, or low-risk inconsistency

### Likely Signal

Use one of:

- `UI`
- `console/runtime`
- `network/API`
- `state sync`
- `auth/session`
- `accessibility`
- `unknown`

## Failure Rules

- If the app never loads, produce a blocked QA report and list every scenario that could not run.
- If credentials or data are missing, stop making execution claims beyond what was actually observed.
- If one blocker prevents downstream coverage, list the blocked scenarios explicitly.
- If no bugs are found, still state what was covered, what was not covered, and the remaining risk.

## References

- `references/report-template.md`
- `references/scenario-catalog.md`
- `references/diagnostic-playbook.md`
