import {
  actionTypes,
  isDeprecatedMacroActionType,
  prepareAgentPlanForDispatch,
  primitiveActionTypes,
  targetKeys,
} from "../../packages/action-protocol/index.mjs";
import { planForQuestion } from "./router.mjs";

function compact(value, maxLength = 900) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function plannerMode(env = process.env) {
  return env.AGENT_PLANNER || (env.LLM_PLANNER_ENABLED ? "local-llm" : "deterministic");
}

function envFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function plannerFailClosed(env = process.env) {
  return envFlag(env.AGENT_PLANNER_FAIL_CLOSED || env.LLM_PLANNER_FAIL_CLOSED || env.H100_PROOF_MODE);
}

function retrievalSummary(retrieval) {
  if (!retrieval || !Array.isArray(retrieval.snippets)) return [];
  return retrieval.snippets.slice(0, 4).map((snippet) => ({
    title: compact(snippet.title, 160),
    text: compact(snippet.text, 700),
    url: compact(snippet.url || snippet.href || "", 240),
  }));
}

function pageSnapshotSummary(pageSnapshot) {
  if (!pageSnapshot || typeof pageSnapshot !== "object") return null;
  return {
    url: compact(pageSnapshot.url, 240),
    title: compact(pageSnapshot.title, 180),
    headings: Array.isArray(pageSnapshot.headings) ? pageSnapshot.headings.slice(0, 10) : [],
    ctas: Array.isArray(pageSnapshot.ctas) ? pageSnapshot.ctas.slice(0, 14) : [],
    navLinks: Array.isArray(pageSnapshot.navLinks) ? pageSnapshot.navLinks.slice(0, 10) : [],
  };
}

export function extractCompletionText(completion) {
  if (typeof completion === "string") return completion;
  if (!completion || typeof completion !== "object") return "";
  if (typeof completion.content === "string") return completion.content;
  const choice = Array.isArray(completion.choices) ? completion.choices[0] : null;
  if (choice && choice.message && typeof choice.message.content === "string") {
    return choice.message.content;
  }
  if (choice && typeof choice.text === "string") return choice.text;
  return "";
}

export function buildPlannerMessages({
  question,
  retrieval,
  pageSnapshot,
  bookingState = "none",
} = {}) {
  const context = {
    question: compact(question, 800),
    bookingState,
    retrieval: retrievalSummary(retrieval),
    pageSnapshot: pageSnapshotSummary(pageSnapshot),
    allowedActions: primitiveActionTypes(),
    allowedTargets: targetKeys(),
  };

  return [
    {
      role: "system",
      content: [
        "You are the local InboundNow website guide planner.",
        "Return exactly one JSON object and no markdown or prose.",
        "Schema: {\"intent\": string, \"answer\": string, \"actions\": array}.",
        "Use only allowed OpenClicky-Web action types and allowlisted target keys from the user context.",
        "Do not use deprecated demo macro actions such as payrollFlow; compose primitive actions instead.",
        "Never include a Cal URL. If booking is useful before confirmation, use showBookingPrompt.",
        "Do not claim real ASR, real TTS, hosted Moss, or LiveKit Cloud.",
        "Keep answers concise and grounded in the provided retrieval/page context.",
      ].join(" "),
    },
    {
      role: "user",
      content: "Create an agent plan JSON for this local website session:\n" + JSON.stringify(context, null, 2),
    },
  ];
}

function deterministicPlan(question, context = {}, planner = {}) {
  const plan = planForQuestion(question, { retrieval: context.retrieval });
  return {
    plan,
    preparedActions: [],
    planner: {
      source: "deterministic-router",
      provider: "",
      enabled: !!planner.enabled,
      fallback: !!planner.fallback,
      error: planner.error || "",
    },
  };
}

function failOrFallback(question, context, planner, env) {
  if (plannerFailClosed(env)) {
    const error = new Error(planner.error || "local planner failed closed");
    error.planner = planner;
    throw error;
  }
  return deterministicPlan(question, context, planner);
}

export async function planQuestion({
  question,
  retrieval,
  pageSnapshot,
  bookingState = "none",
  adapters = {},
  env = process.env,
  generateId,
} = {}) {
  if (plannerMode(env) !== "local-llm") {
    return deterministicPlan(question, { retrieval }, { enabled: false });
  }

  const llm = adapters.llm;
  if (!llm || llm.provider !== "qwen-openai-local" || typeof llm.complete !== "function") {
    return failOrFallback(question, { retrieval }, {
      enabled: true,
      fallback: true,
      error: "local-llm planner requires LLM_PROVIDER=qwen-openai-local",
    }, env);
  }

  try {
    const completion = await llm.complete({
      messages: buildPlannerMessages({ question, retrieval, pageSnapshot, bookingState }),
      temperature: Number(env.LLM_PLANNER_TEMPERATURE || 0.1),
      maxTokens: Number(env.LLM_PLANNER_MAX_TOKENS || 900),
    });
    const prepared = prepareAgentPlanForDispatch(extractCompletionText(completion), {
      bookingState,
      generateId,
    });
    const macroAction = prepared.actions.find((action) => isDeprecatedMacroActionType(action.type));
    if (macroAction) {
      throw new Error("local LLM planner returned deprecated demo macro action: " + macroAction.type);
    }
    return {
      plan: prepared.plan,
      preparedActions: prepared.actions,
      planner: {
        source: "local-llm-json",
        provider: llm.provider,
        enabled: true,
        fallback: false,
        error: "",
      },
    };
  } catch (error) {
    return failOrFallback(question, { retrieval }, {
      enabled: true,
      fallback: true,
      error: error.message || String(error),
    }, env);
  }
}
