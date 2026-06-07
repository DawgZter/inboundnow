const ACTION_TYPES = new Set([
  "clickElement",
  "highlightElement",
  "moveCursorToElement",
  "navigate",
  "openCal",
  "payrollFlow",
  "scrollToElement",
  "showBookingPrompt",
  "showCaption",
  "snapshotPage",
]);

const TARGET_KEYS = new Set(["country", "demo", "eor", "payroll", "pricing"]);
const CONFIRMED_BOOKING_STATE = "confirmed";

export class ActionProtocolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ActionProtocolError";
    this.details = details;
  }
}

export function actionTypes() {
  return Array.from(ACTION_TYPES).sort();
}

export function targetKeys() {
  return Array.from(TARGET_KEYS).sort();
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function cloneObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasText(value) {
  if (typeof value === "string") return cleanString(value).length > 0;
  if (Array.isArray(value)) return value.some((item) => hasText(item));
  return false;
}

export function validateTarget(target) {
  const errors = [];

  if (!isPlainObject(target)) {
    return ["target must be an object"];
  }

  if ("key" in target) {
    if (!TARGET_KEYS.has(target.key)) errors.push("target.key is not allowlisted");
  }

  if ("ocwId" in target && cleanString(target.ocwId).length === 0) {
    errors.push("target.ocwId must be a non-empty string");
  }

  if ("selector" in target) {
    const selector = cleanString(target.selector);
    if (!selector) errors.push("target.selector must be a non-empty string");
    if (/script|iframe|object|embed/i.test(selector)) {
      errors.push("target.selector cannot target scriptable embeds");
    }
  }

  if ("text" in target && !hasText(target.text)) {
    errors.push("target.text must include text");
  }

  if ("href" in target && !hasText(target.href)) {
    errors.push("target.href must include text");
  }

  const hasLocator =
    TARGET_KEYS.has(target.key) ||
    cleanString(target.ocwId).length > 0 ||
    cleanString(target.selector).length > 0 ||
    hasText(target.text) ||
    hasText(target.href) ||
    hasText(target.role) ||
    hasText(target.label);

  if (!hasLocator) errors.push("target must include key, ocwId, selector, text, href, role, or label");

  return errors;
}

function validateUrl(action) {
  const raw = cleanString(action.url || action.href || action.target);
  if (!raw) return ["navigate.url must be a non-empty string"];

  try {
    const parsed = new URL(raw, "https://remote.com");
    if (["javascript:", "data:", "file:", "blob:"].includes(parsed.protocol)) {
      return ["navigate.url uses a forbidden protocol"];
    }
  } catch {
    return ["navigate.url must be parseable"];
  }

  return [];
}

export function validateAction(action, options = {}) {
  const errors = [];
  const bookingState = options.bookingState || "none";

  if (!isPlainObject(action)) {
    return { ok: false, errors: ["action must be an object"] };
  }

  if (!ACTION_TYPES.has(action.type)) {
    return { ok: false, errors: [`unknown action type: ${String(action.type || "")}`] };
  }

  if ("id" in action && cleanString(action.id).length === 0) {
    errors.push("action.id must be a non-empty string when provided");
  }

  if (["clickElement", "highlightElement", "moveCursorToElement", "scrollToElement"].includes(action.type)) {
    errors.push(...validateTarget(action.target));
  }

  if (action.type === "navigate") {
    errors.push(...validateUrl(action));
  }

  if (action.type === "showCaption") {
    const text = cleanString(action.text || action.caption);
    if (!text) errors.push("showCaption requires text or caption");
  }

  if (action.type === "payrollFlow" && "answer" in action && cleanString(action.answer).length === 0) {
    errors.push("payrollFlow.answer must be non-empty when provided");
  }

  if (action.type === "openCal" && bookingState !== CONFIRMED_BOOKING_STATE) {
    errors.push("openCal requires bookingState=confirmed");
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidAction(action, options = {}) {
  const result = validateAction(action, options);
  if (!result.ok) {
    throw new ActionProtocolError("Invalid OpenClicky-Web action", {
      action,
      errors: result.errors,
    });
  }
  return action;
}

export function gateActionForBooking(action, options = {}) {
  const bookingState = options.bookingState || "none";
  if (isPlainObject(action) && action.type === "openCal" && bookingState !== CONFIRMED_BOOKING_STATE) {
    return {
      id: action.id,
      type: "showBookingPrompt",
      reason: "open_cal_requires_confirmation",
      gatedFrom: "openCal",
    };
  }
  return action;
}

export function prepareActionForDispatch(action, options = {}) {
  const generateId = options.generateId || (() => undefined);
  const gated = gateActionForBooking(action, options);
  const prepared = cloneObject(gated);

  if (!prepared.id) {
    const id = generateId(prepared);
    if (id) prepared.id = id;
  }

  assertValidAction(prepared, options);
  return prepared;
}

export function prepareActionsForDispatch(actions, options = {}) {
  if (!Array.isArray(actions)) {
    throw new ActionProtocolError("Action plan must be an array", { actions });
  }

  return actions.map((action) => prepareActionForDispatch(action, options));
}

export function validateActionPlan(actions, options = {}) {
  if (!Array.isArray(actions)) {
    return { ok: false, errors: ["actions must be an array"] };
  }

  const errors = [];
  actions.forEach((action, index) => {
    const result = validateAction(action, options);
    if (!result.ok) {
      for (const error of result.errors) errors.push(`actions[${index}]: ${error}`);
    }
  });

  return { ok: errors.length === 0, errors };
}

