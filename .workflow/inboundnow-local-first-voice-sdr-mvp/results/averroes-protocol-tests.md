# Averroes: Protocol And Regression Design

Read-only report received during round 1. No files edited by the subagent.

## Accepted Immediately

- Keep the action protocol dependency-free.
- Validate the temporary `payrollFlow` macro plus primitive browser actions.
- Enforce target requirements for cursor/highlight/scroll/click actions.
- Reject unsafe `navigate` protocols.
- Gate `openCal` on confirmed booking state.
- Reject `openCal` URLs because the browser owns `CAL_URL`.
- Add text-length limits so model output cannot flood the widget.
- Add `ocw_*` validation for widget-generated element ids.
- Expose browser/action-plan alias helpers for future browser extraction.

## Deferred

- Browser-side import of the same validator is deferred until the injected widget
  is split out of `apps/website-lab/server.mjs` or a small bundle path exists.
- Playwright/browser fixture tests are deferred to the E2E smoke slice.
- Migrating router output from `payrollFlow` to primitive actions is deferred
  until the browser bridge and protocol fixtures are stable.
