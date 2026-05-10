export type ResponseMode =
  | "direct_answer"
  | "clarify_then_answer"
  | "escalate_conservatively";

export interface TroubleContext {
  rawUserMessage: string;
  normalizedSymptom?: string;
  factory?: string;
  line?: string;
  station?: string;
  equipment?: string;
  actionState: string[];
  alarmCodes: string[];
  observedEffects: string[];
  missingCriticalSlots: string[];
  preservedKeywords: string[];
  confidence: "high" | "medium" | "low";
}

export interface ModeDecision {
  mode: ResponseMode;
  rationale: string;
  missingSlotsToAsk: string[];
  canProceedWithRetrieval: boolean;
}

export interface AnswerContractSection {
  key:
    | "historical_facts"
    | "suspected_direction"
    | "recommended_action"
    | "escalation_conditions";
  title: string;
  instruction: string;
}

export interface AnswerContract {
  sections: AnswerContractSection[];
}

export interface RuntimeTurnPlan {
  context: TroubleContext;
  decision: ModeDecision;
  answerContract: AnswerContract;
}
