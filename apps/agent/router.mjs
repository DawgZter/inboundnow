const PAYROLL_ANSWER =
  "Remote helps with global payroll by giving companies one place to pay distributed teams, handle country-specific payroll rules, keep compliance connected to hiring, and guide buyers toward the right next step.";

function globalPayrollActions(answer = PAYROLL_ANSWER) {
  return [
    {
      type: "showCaption",
      text: "I will point out Remote's global payroll context, then keep booking gated until you confirm.",
    },
    {
      type: "scrollToElement",
      target: { key: "payroll" },
      caption: "Bringing global payroll into view.",
    },
    {
      type: "highlightElement",
      target: { key: "payroll" },
    },
    {
      type: "showBookingPrompt",
      reason: "payroll_next_step",
      answer,
    },
  ];
}

export function planForQuestion(question) {
  const text = String(question || "").toLowerCase();

  if (text.includes("payroll") || text.includes("global pay")) {
    return {
      intent: "global_payroll",
      answer: PAYROLL_ANSWER,
      actions: globalPayrollActions(),
    };
  }

  if (text.includes("pricing") || text.includes("price")) {
    return {
      intent: "pricing",
      answer: "I can pull up Remote pricing and keep the page movement visible while we talk.",
      actions: [
        {
          type: "scrollToElement",
          target: { key: "pricing" },
          caption: "I will bring pricing into view.",
        },
        {
          type: "highlightElement",
          target: { key: "pricing" },
        },
      ],
    };
  }

  if (text.includes("country")) {
    return {
      intent: "country_explorer",
      answer: "For country-specific hiring or payroll rules, I can guide you to Remote's country explorer.",
      actions: [
        {
          type: "scrollToElement",
          target: { key: "country" },
          caption: "I will look for country-specific guidance.",
        },
        {
          type: "highlightElement",
          target: { key: "country" },
        },
      ],
    };
  }

  return {
    intent: "fallback",
    answer: "I can help with Remote's payroll, hiring, compliance, pricing, and country-specific workflows. Try asking how Remote helps with global payroll.",
    actions: [
      {
        type: "showCaption",
        text: "Try asking how Remote helps with global payroll.",
      },
    ],
  };
}
