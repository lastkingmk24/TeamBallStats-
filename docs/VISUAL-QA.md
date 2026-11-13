# Browser QA — cloud, game insights and shot clock

Checked 2026-11-13 using headless Chromium via Playwright against the optional
Node server, with sample-data.json and an on-device league management account.
Browser tooling and temporary databases were kept outside the repository.

## Checked

- Cloud sign-in form at 390px and 1440px viewport widths; mobile fields and
  buttons wrap within the panel.
- Missing API simulated with HTTP 404 responses: cloud wrapper is hidden.
- Local recap rendered at 390px and 1440px with no API. Measured statistics,
  rule-based analysis and lineup output work without a cloud sign-in or Pro plan.
- Shot-clock controls at 390px and 1440px in light and dark themes.
- Reset shows 24; starting the game clock advances the shot countdown to 23;
  pause is operable. No uncaught browser errors in these checks.

## Fixed

The scoreboard always uses a dark surface, but the shot-clock label and number
used theme-dependent foreground colours. In light mode the number was nearly
invisible. They now use light scoreboard-safe colours, with a light pink expired
indicator in both themes.

## Remaining scope

This is not a complete visual certification: authenticated cloud sync/conflict
screens and long lineup tables still need visual inspection, as do other
browsers and narrower viewport sizes.
The no-API check used a local 404 simulation, not the deployed GitHub Pages site.
Cloud controls now hide without an API; game insights have no Pro gate.

## Regression tests

- `node tests/smoke.js` — 59 passed.
- `node tests/engine.js` — 16 passed.
- `node tests/server.js` — 25 passed.
- Optional jsdom harness: 26 DOM checks and 13 cloud checks passed, including
  recap/lineup generation with the network unavailable.
