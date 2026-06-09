# QA Report Template

Use this structure for the final response. Omit empty bullets only when the omission is explicit and safe.

## Feature Summary

- Feature:
- Goal:
- Scope tested:
- Requested focus:

## Environment

- URL or environment:
- Browser and viewport:
- Role or account:
- Test data or setup:
- Execution mode: `Playwright`, `Manual reasoning`, or `Mixed`
- Assumptions:

## Coverage Matrix

| Scenario | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Happy path | Passed/Failed/Blocked/Not Run | Screenshot, console, request, or observation | Short note |

Add rows for every scenario actually considered. Do not collapse blocked or unrun scenarios into prose only.

## Findings

If no confirmed bugs were found, say `No confirmed bugs found.` and continue with the remaining sections.

### BUG-001: Short title

- Severity: `P0` | `P1` | `P2` | `P3`
- Scenario:
- Preconditions:
- Steps to Reproduce:
  1.
  2.
  3.
- Expected Result:
- Actual Result:
- Evidence:
- Likely Signal: `UI` | `console/runtime` | `network/API` | `state sync` | `auth/session` | `accessibility` | `unknown`
- Notes / Suspected Root Cause:

Repeat for each confirmed bug.

## Blocked / Not Run

- Scenario:
- Status: `Blocked` or `Not Run`
- Reason:
- Missing input or dependency:
- Risk created by the gap:

## Risk Assessment

- Residual risks:
- Nearby regressions worth checking next:
- Recommended follow-up:
