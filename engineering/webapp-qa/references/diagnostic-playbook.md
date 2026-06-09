# Diagnostic Playbook

Use this guide after a scenario fails or looks suspicious. Start with the smallest diagnostic surface that can explain the problem.

## Start Here

Always capture:

- the scenario name
- the exact page or route
- a screenshot of the failing state
- console warnings or errors
- uncaught page errors
- failed requests

If those artifacts already explain the bug, stop there and write the report.

## Choose the Next Diagnostic Surface

### Console or Runtime

Use when:

- the UI freezes, crashes, or silently does nothing
- a button click triggers visible failure without clear network symptoms
- hydration, rendering, or script errors are likely

Capture:

- relevant console messages
- uncaught exceptions
- stack or component hints when present

### Network or API

Use when:

- the UI shows loading forever
- data is missing, stale, or inconsistent
- the bug appears after submit, fetch, save, delete, or refresh

Capture:

- request URL and method
- status code
- failure mode or malformed response clue
- whether the UI handled the failure correctly

### DOM or Rendered State

Use when:

- the visible UI contradicts the expected state
- text, selection, disabled state, or visibility looks wrong
- navigation appears to complete but the wrong content renders

Capture:

- visible text or labels
- control state
- relevant attributes or route/query state

### Storage or Session

Use when:

- auth seems stale or role-dependent
- a flag, draft, or remembered filter behaves inconsistently
- reload changes behavior in a way that suggests persistence issues

Capture:

- the specific cookie, local storage, or session storage clue
- why that clue explains the observed behavior

### Accessibility

Use when:

- focus disappears or lands incorrectly
- screen-readable naming is likely wrong
- a control looks present but may be semantically broken

Capture:

- focus target or focus loss
- missing or wrong accessible name
- role or disabled-state mismatch

## Reporting Discipline

- Confirm bugs only when the scenario, evidence, and behavior line up.
- Keep suspicions separate from confirmed findings.
- Prefer one strong evidence chain over a long unfocused dump.
- If diagnostics increase uncertainty instead of resolving it, report the uncertainty plainly.
