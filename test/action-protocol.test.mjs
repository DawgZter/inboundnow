import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActionProtocolError,
  prepareActionForDispatch,
  prepareActionsForDispatch,
  validateAction,
  validateAgentPlan,
  validateActionPlan,
} from "../packages/action-protocol/index.mjs";
import { planForQuestion } from "../apps/agent/router.mjs";

test("validates allowlisted target actions", () => {
  const result = validateAction({
    type: "moveCursorToElement",
    target: { key: "payroll" },
    caption: "Remote global payroll",
  });

  assert.equal(result.ok, true);
});

test("rejects unknown action types", () => {
  const result = validateAction({ type: "driveNativeDesktop" });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unknown action type/);
});

test("rejects target actions without a locator", () => {
  const result = validateAction({ type: "highlightElement", target: {} });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /target must include/);
});

test("rejects unsafe navigation protocols", () => {
  const result = validateAction({ type: "navigate", url: "javascript:alert(1)" });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /forbidden protocol/);
});

test("rejects malformed widget ids", () => {
  const result = validateAction({
    type: "scrollToElement",
    target: { ocwId: "payroll-cta" },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /ocw_\*/);
});

test("rejects overlong captions", () => {
  const result = validateAction({
    type: "showCaption",
    text: "x".repeat(361),
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /<= 360/);
});

test("rejects openCal URLs from agent output", () => {
  const result = validateAction(
    { type: "openCal", url: "https://cal.com/not-owned-by-browser" },
    { bookingState: "confirmed" },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /must not include url/);
});

test("gates openCal until booking confirmation", () => {
  const prepared = prepareActionForDispatch(
    { type: "openCal" },
    { bookingState: "prompt_shown", generateId: () => "act_gate" },
  );

  assert.deepEqual(prepared, {
    id: "act_gate",
    type: "showBookingPrompt",
    reason: "open_cal_requires_confirmation",
    gatedFrom: "openCal",
  });
});

test("allows openCal after booking confirmation", () => {
  const prepared = prepareActionForDispatch(
    { type: "openCal" },
    { bookingState: "confirmed", generateId: () => "act_cal" },
  );

  assert.deepEqual(prepared, { id: "act_cal", type: "openCal" });
});

test("throws for invalid dispatch plans", () => {
  assert.throws(
    () => prepareActionsForDispatch([{ type: "showCaption" }], { generateId: () => "act_bad" }),
    ActionProtocolError,
  );
});

test("router payroll plan emits protocol-valid actions", () => {
  const plan = planForQuestion("How does Remote help with global payroll?");
  const result = validateAgentPlan(plan);

  assert.equal(plan.intent, "global_payroll");
  assert.equal(result.ok, true, result.errors.join("\n"));
});
