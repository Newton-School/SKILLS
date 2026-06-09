# Webapp QA

**Domain:** engineering
**Author:** @DipeshRajoria007

## What it does

Webapp QA is an agent-agnostic skill for planning, executing, and reporting evidence-backed QA passes for web applications. It helps coding agents turn a feature or bug report into a coverage matrix, run browser-based checks, investigate suspicious behavior, and produce a structured QA report.

## When to use it

- Test a web feature, workflow, regression, or bug fix before signoff.
- Reproduce or triage browser bugs with screenshots, console output, network signals, or DOM observations.
- Validate happy paths, edge cases, loading/error states, permissions, responsive behavior, and accessibility smoke checks.
- Produce a QA report that clearly separates passed, failed, blocked, and not-run coverage.

## Install

This skill is distributed as a plain folder. Install it by copying the whole `engineering/webapp-qa/` directory, including `SKILL.md` and `references/`, into the place where your coding agent reads reusable skills or instructions.

One-command install for Codex-style skill folders:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/webapp-qa/install.sh | bash -s -- codex
```

One-command install for Claude-style skill folders:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/webapp-qa/install.sh | bash -s -- claude
```

One-command install for another destination:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/webapp-qa/install.sh | bash -s -- "$HOME/.config/my-agent/skills/webapp-qa"
```

From a local checkout of this repository:

```bash
git clone https://github.com/Newton-School/SKILLS.git
cd SKILLS
```

For Codex-style skill folders:

```bash
./engineering/webapp-qa/install.sh codex
```

For Claude-style skill folders:

```bash
./engineering/webapp-qa/install.sh claude
```

For other coding agents, copy `engineering/webapp-qa/` into the agent's custom instructions, skills, prompts, or reusable context directory. If the agent does not support skill folders, point it at `engineering/webapp-qa/SKILL.md` and keep the `references/` directory available.

## How to use it

1. Ask your coding agent to use `webapp-qa` for a target feature, flow, or bug report.
2. Provide the target URL or environment, expected behavior, required credentials or roles, and any known acceptance criteria.
3. Let the skill build a coverage matrix before browser execution begins.
4. Run real browser checks with the available Playwright/browser automation workflow when the app is reachable.
5. Use the generated report to review confirmed findings, blocked coverage, residual risk, and recommended follow-up.

Example prompt:

```text
Use webapp-qa to test the checkout coupon flow at https://staging.example.com.
Expected behavior: valid coupons apply a discount, invalid coupons show inline validation, and refresh preserves the applied coupon.
Test desktop and mobile viewports.
```

## Requirements

- A reachable web application URL or local environment.
- Any credentials, roles, feature flags, seed data, or setup steps needed to exercise the flow.
- Browser automation support, preferably Playwright or an equivalent browser workflow available to the coding agent, when real execution is expected.
- Permission to inspect browser-visible evidence such as screenshots, console errors, failed requests, DOM state, storage, or cookies when relevant.

## Notes

- Do not mark a scenario as passed unless it was actually executed and observed.
- If the app is unreachable, credentials are missing, or test data is unavailable, produce a blocked QA report instead of making execution claims.
- Keep suspected issues separate from confirmed bugs unless the scenario, evidence, and observed behavior line up.
- The report template, scenario catalog, and diagnostic playbook live in `references/`.
