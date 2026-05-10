import { understandTroubleContext } from "./inputUnderstanding.js";
import { decideResponseMode } from "./modePolicy.js";
import type { AnswerContract, RuntimeTurnPlan } from "./types.js";

export function buildAnswerContract(): AnswerContract {
  return {
    sections: [
      {
        key: "historical_facts",
        title: "历史案例事实",
        instruction: "仅总结 MCP 检索结果中可明确支持的历史案例事实。",
      },
      {
        key: "suspected_direction",
        title: "当前怀疑方向",
        instruction:
          "把当前判断表述为怀疑方向，不要写成已确认结论。尽量保留最强历史案例里的部件名、工位名或原始术语锚点，例如 Shrouds、Bohrung、Käfigmutter、X-Drive。若历史证据分成多条可疑分支，也要在本节明确点名 1-2 个最强历史原因锚点，不要只把它们概括成泛化类别。",
      },
      {
        key: "recommended_action",
        title: "建议先做的检查或操作",
        instruction: "只给低风险、适合现场操作员执行的下一步。",
      },
      {
        key: "escalation_conditions",
        title: "何时升级给维修工程师",
        instruction:
          "说明哪些情况应停止继续猜测并升级给维修工程师。请在本节正文里明确写出‘升级给维修工程师’，并优先写出一条与前面低风险检查直接对应的触发条件，例如‘复测后仍失败’、‘换另一件基准件后仍失败’。若原问题或历史锚点本身带英文技术短语，可在括号里补一个简短英文触发语。",
      },
    ],
  };
}

export function planRuntimeTurn(userInput: string): RuntimeTurnPlan {
  const context = understandTroubleContext(userInput);
  const decision = decideResponseMode(context);

  return {
    context,
    decision,
    answerContract: buildAnswerContract(),
  };
}

function formatList(name: string, values: string[]): string {
  return `${name}: ${values.length > 0 ? values.join(", ") : "none"}`;
}

function formatOptional(name: string, value: string | undefined): string {
  return `${name}: ${value ?? "unknown"}`;
}

function containsSymptomLanguage(rawUserMessage: string): boolean {
  return /怀疑|怎么都|不上|进不去|失败|异常|报警|跳|抖|太短|卡住|不圆|a\.t\.|out of specification|out of spec|fail|failed|won't|cannot|can't/i.test(
    rawUserMessage,
  );
}

function isLikelyNarrowFollowUp(turnPlan: RuntimeTurnPlan): boolean {
  const { context, decision } = turnPlan;
  return Boolean(
    decision.mode === "direct_answer" &&
    context.factory &&
    context.rawUserMessage.length <= 80 &&
    (context.station || context.equipment) &&
    context.actionState.length === 0 &&
    context.alarmCodes.length === 0 &&
    context.observedEffects.length === 0 &&
    !containsSymptomLanguage(context.rawUserMessage),
  );
}

export function buildTurnEnvelope(userInput: string): {
  promptInput: string;
  turnPlan: RuntimeTurnPlan;
} {
  const turnPlan = planRuntimeTurn(userInput);
  const likelyNarrowFollowUp = isLikelyNarrowFollowUp(turnPlan);
  const sectionLines = turnPlan.answerContract.sections.map(
    (section, index) =>
      `${index + 1}. ${section.title}: ${section.instruction}`,
  );
  const normalizedSymptomForEnvelope = likelyNarrowFollowUp
    ? undefined
    : turnPlan.context.normalizedSymptom;

  const promptInput = [
    "RUNTIME_TURN_PLAN",
    `preferred_mode: ${turnPlan.decision.mode}`,
    `mode_rationale: ${turnPlan.decision.rationale}`,
    formatList("missing_slots_to_ask", turnPlan.decision.missingSlotsToAsk),
    `likely_narrow_follow_up: ${likelyNarrowFollowUp ? "true" : "false"}`,
    formatOptional("factory", turnPlan.context.factory),
    formatOptional("equipment", turnPlan.context.equipment),
    formatOptional("station", turnPlan.context.station),
    formatOptional("normalized_symptom", normalizedSymptomForEnvelope),
    formatList("action_state", turnPlan.context.actionState),
    formatList("alarm_codes", turnPlan.context.alarmCodes),
    formatList("observed_effects", turnPlan.context.observedEffects),
    formatList("missing_critical_slots", turnPlan.context.missingCriticalSlots),
    formatList("preserved_keywords", turnPlan.context.preservedKeywords),
    "follow_up_guidance:",
    likelyNarrowFollowUp
      ? "- This message looks like a narrow follow-up slot answer. Combine it with the immediately previous troubleshooting symptom in the conversation before retrieval. Do not replace the original symptom with this short reply."
      : "- Use the current message together with the conversation context when building retrieval.",
    "answer_contract_when_answering:",
    ...sectionLines,
    "grounding_rules:",
    "- Treat runtime hints as routing hints, not as confirmed facts.",
    "- Ground claims in retrieved historical cases.",
    "- If you ask a clarification question, ask one direct question only.",
    "- If you answer, use the exact four Chinese section titles listed above.",
    "ORIGINAL_USER_MESSAGE:",
    userInput,
  ].join("\n");

  return {
    promptInput,
    turnPlan,
  };
}
