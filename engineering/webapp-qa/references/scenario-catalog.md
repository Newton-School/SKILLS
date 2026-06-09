# Scenario Catalog

Use this catalog to turn a vague feature request into a concrete coverage matrix. Pick the subsets that match the feature instead of forcing every check.

## Core Flow Set

- happy path from entry to visible success state
- alternate but valid path through the same outcome
- cancellation, close, back, or reset behavior where applicable
- repeat action behavior after one successful run

## Input and Validation

- blank input
- malformed input
- boundary values
- inline validation timing
- submit while invalid
- recovery after fixing invalid input

## Async and Data States

- initial loading
- refresh behavior or refetch
- empty response
- partial data
- generic error state
- server error
- timeout or failed request if safely reproducible

## Navigation and Persistence

- direct deep link
- refresh behavior
- browser back or forward
- query param or route state persistence
- reopen after prior interaction

## Auth and Permissions

- logged-out behavior
- wrong role or insufficient permission
- expired session
- post-login return path

## Responsive and Device

- desktop default viewport
- smaller desktop or laptop viewport
- mobile viewport when the flow is mobile-relevant
- touch interaction for mobile-only controls

## Accessibility Smoke Checks

- focus reaches the main controls
- labels and visible text match the intended action
- disabled states are perceivable
- errors are visible and understandable

## Nearby Regression Checks

- adjacent filters, tabs, or controls touched by the same state
- shared components reused by the feature
- create/edit/delete follow-up behavior if the feature mutates data

## Heuristics by Feature Type

### Forms

- draft state retention
- duplicate submit protection
- server-side validation mapping

### Lists, tables, dashboards

- sort, filter, and pagination interaction
- empty and dense states
- row action correctness

### Auth flows

- redirect chain correctness
- session refresh handling
- post-auth landing state

### Upload or import flows

- wrong file type
- oversized file
- progress and retry behavior

### Search flows

- no results
- delayed results
- stale query or filter persistence
