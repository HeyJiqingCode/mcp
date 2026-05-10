import type { ModeDecision, TroubleContext } from "./types.js";

function detectAxisConflict(rawUserMessage: string): boolean {
  const normalized = rawUserMessage.toLowerCase();
  const mentionsX = /\bx\b|x轴/.test(normalized);
  const mentionsY = /\by\b|y轴/.test(normalized);
  const mentionsZ = /\bz\b|z轴/.test(normalized);
  const axisCount = [mentionsX, mentionsY, mentionsZ].filter(Boolean).length;
  return (
    axisCount >= 2 &&
    /(vs\.|versus|还是|或者|\bor\b|有人说|怀疑|像)/i.test(rawUserMessage)
  );
}

function hasCompetingCauseHypotheses(rawUserMessage: string): boolean {
  return /有人说.+有人说|有人怀疑.+有人怀疑|some say.+some say|one says.+another says/i.test(
    rawUserMessage,
  );
}

function canProceedWithoutFactory(context: TroubleContext): boolean {
  return Boolean(
    context.normalizedSymptom &&
    (context.station || context.equipment) &&
    hasCompetingCauseHypotheses(context.rawUserMessage),
  );
}

export function decideResponseMode(context: TroubleContext): ModeDecision {
  if (detectAxisConflict(context.rawUserMessage)) {
    return {
      mode: "clarify_then_answer",
      rationale: "Axis references conflict and block grounded routing.",
      missingSlotsToAsk: ["affected_axis"],
      canProceedWithRetrieval: false,
    };
  }

  if (!context.factory && canProceedWithoutFactory(context)) {
    return {
      mode: "direct_answer",
      rationale:
        "Competing cause hypotheses plus the current routing detail justify a first grounded retrieval pass before asking for factory.",
      missingSlotsToAsk: [],
      canProceedWithRetrieval: true,
    };
  }

  if (!context.factory) {
    return {
      mode: "clarify_then_answer",
      rationale:
        "Factory is missing and usually needed to keep retrieval grounded.",
      missingSlotsToAsk: ["factory"],
      canProceedWithRetrieval: false,
    };
  }

  if (!context.normalizedSymptom) {
    return {
      mode: "clarify_then_answer",
      rationale: "The symptom is too vague for grounded historical retrieval.",
      missingSlotsToAsk: ["symptom"],
      canProceedWithRetrieval: false,
    };
  }

  if (context.confidence === "low" && context.missingCriticalSlots.length > 1) {
    return {
      mode: "escalate_conservatively",
      rationale:
        "The current turn is too underspecified to support safe guidance.",
      missingSlotsToAsk: context.missingCriticalSlots,
      canProceedWithRetrieval: false,
    };
  }

  return {
    mode: "direct_answer",
    rationale:
      "The current turn contains enough routing detail for a first grounded retrieval pass.",
    missingSlotsToAsk: [],
    canProceedWithRetrieval: true,
  };
}
