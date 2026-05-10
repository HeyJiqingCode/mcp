import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createProjectAndOpenAIClient,
  createTroubleshootingAgent,
  createTroubleshootingRuntime,
  runAgentTurn,
  shouldDeleteAgentVersion,
} from "./foundryAgent.js";

type ManifestDatasetEntry = {
  dataset_id: string;
  dataset_name: string;
  derived_from: string | null;
  file: string;
  role: string;
  source_cases_file: string;
  split_type: string;
  test_case_count: number;
};

type ManifestFile = {
  authoritative_dataset_id?: string;
  base_path?: string;
  datasets: ManifestDatasetEntry[];
  manifest_name: string;
  manifest_version: number;
};

type GoldenAnswer = {
  answer_notes: string | null;
  component_name: string;
  failure_reason: string;
  handling_steps: string;
};

type ExpectedMode = "direct_answer" | "clarify_then_answer";

type ResponseContractDefaults = {
  required_sections: string[];
  require_escalation_section: boolean;
  require_historical_fact_grounding: boolean;
  require_recommended_action_section: boolean;
  require_suspected_direction_hedging: boolean;
  required_escalation_keywords: string[];
};

type GoldenTestCase = {
  correct_answer: GoldenAnswer;
  expected_mode?: ExpectedMode;
  expected_clarifying_focus?: string;
  expected_first_step: string;
  follow_up_user_reply: string | null;
  golden_test_id: string;
  initial_user_input: string;
  acceptable_suspected_direction_keywords?: string[];
  acceptable_suspected_direction_keyword_matches?: number;
  forbidden_first_turn_keywords?: string[];
  forbidden_claim_keywords?: string[];
  reference_context: Record<string, string>;
  required_first_turn_keywords?: string[];
  required_first_turn_keyword_matches?: number;
  required_escalation_keywords?: string[];
  required_escalation_keyword_matches?: number;
  required_historical_fact_keywords?: string[];
  required_historical_fact_keyword_matches?: number;
  required_recommended_action_keywords?: string[];
  required_recommended_action_keyword_matches?: number;
  scenario_type: string;
  source_case_id: string;
};

type GoldenDatasetFile = {
  dataset_name: string;
  evaluation_target?: string;
  evaluation_version?: number;
  response_contract_defaults?: Partial<ResponseContractDefaults>;
  test_case_count: number;
  test_cases: GoldenTestCase[];
};

type CliOptions = {
  datasetIds: string[];
  dryRun: boolean;
  includeFull: boolean;
  manifestPath: string;
  maxCasesPerDataset: number | null;
  outputPath: string;
};

type FieldCheck = {
  applicable: boolean;
  exact_match: boolean;
  passed: boolean;
  token_coverage: number;
};

type KeywordCheck = {
  matched_keywords: string[];
  missing_keywords: string[];
  passed: boolean;
};

type SectionCheck = {
  passed: boolean;
  keyword_check: KeywordCheck;
  section_present: boolean;
};

type AbsenceCheck = {
  found_forbidden_keywords: string[];
  passed: boolean;
};

type AnswerSectionMap = Partial<
  Record<(typeof ANSWER_SECTION_TITLES)[number], string>
>;

const IGNORABLE_EXPECTED_VALUES = new Set(["", "--", "noch keine"]);
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "das",
  "der",
  "die",
  "ein",
  "eine",
  "for",
  "in",
  "ist",
  "mit",
  "of",
  "on",
  "or",
  "the",
  "to",
  "und",
  "zu",
]);

const ANSWER_SECTION_TITLES = [
  "历史案例事实",
  "当前怀疑方向",
  "建议先做的检查或操作",
  "何时升级给维修工程师",
] as const;

const DEFAULT_RESPONSE_CONTRACT: ResponseContractDefaults = {
  required_sections: [...ANSWER_SECTION_TITLES],
  require_escalation_section: true,
  require_historical_fact_grounding: true,
  require_recommended_action_section: true,
  require_suspected_direction_hedging: true,
  required_escalation_keywords: [
    "升级",
    "维修工程师",
    "停止继续",
    "超出操作员",
  ],
};

const SUSPECTED_DIRECTION_MARKERS = ["怀疑", "最像", "更像", "倾向", "可能"];
const RECOMMENDED_ACTION_MARKERS = [
  "检查",
  "确认",
  "观察",
  "记录",
  "复测",
  "不要",
  "先",
  "校准",
  "清洁",
  "对比",
];
const HISTORICAL_GROUNDING_MARKERS = [
  "历史",
  "案例",
  "记录",
  "检索",
  "同厂",
  "处理",
];

function printUsage(): void {
  console.log(
    [
      "Usage: npm run regression -- --manifest <path> [options]",
      "       npm run regression -- <manifest-path> [output-path]",
      "       npm run regression:dry-run -- <manifest-path> [output-path]",
      "",
      "Options:",
      "  --manifest <path>     Path to golden_test_cases.manifest.json.",
      "  --dataset <id>        Limit execution to a dataset_id. Repeatable.",
      "  --include-full        Include the authoritative full dataset when no --dataset is provided.",
      "  --max-cases <n>       Run at most n cases per selected dataset.",
      "  --output <path>       Write the JSON report to this path.",
      "  --dry-run             Validate manifest traversal without calling Foundry.",
      "  --help                Show this message.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: "",
    outputPath: "regression_manifest_report.json",
    datasetIds: [],
    includeFull: false,
    maxCasesPerDataset: null,
    dryRun: false,
  };
  const positionalArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--include-full") {
      options.includeFull = true;
      continue;
    }
    if (
      arg === "--manifest" ||
      arg === "--output" ||
      arg === "--dataset" ||
      arg === "--max-cases"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      index += 1;
      if (arg === "--manifest") {
        options.manifestPath = value;
      } else if (arg === "--output") {
        options.outputPath = value;
      } else if (arg === "--dataset") {
        options.datasetIds.push(value);
      } else {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error("--max-cases must be a positive integer.");
        }
        options.maxCasesPerDataset = parsed;
      }
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  if (!options.manifestPath && positionalArgs.length > 0) {
    options.manifestPath = positionalArgs.shift() ?? "";
  }

  if (
    options.outputPath === "regression_manifest_report.json" &&
    positionalArgs.length > 0
  ) {
    options.outputPath = positionalArgs.shift() ?? options.outputPath;
  }

  if (positionalArgs.length > 0) {
    throw new Error(
      `Unexpected positional arguments: ${positionalArgs.join(", ")}`,
    );
  }

  if (!options.manifestPath) {
    throw new Error("--manifest is required.");
  }

  return options;
}

async function loadJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string | null | undefined): string[] {
  const matches = normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  return matches.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function isComparableExpectedValue(value: string): boolean {
  return !IGNORABLE_EXPECTED_VALUES.has(normalizeText(value));
}

function computeTokenCoverage(
  actualText: string,
  expectedText: string,
): number {
  const expectedTokens = [...new Set(tokenize(expectedText))];
  if (expectedTokens.length === 0) {
    return 1;
  }

  const actualTokens = new Set(tokenize(actualText));
  const matched = expectedTokens.filter((token) =>
    actualTokens.has(token),
  ).length;
  return matched / expectedTokens.length;
}

function evaluateField(actualText: string, expectedText: string): FieldCheck {
  if (!isComparableExpectedValue(expectedText)) {
    return {
      applicable: false,
      exact_match: false,
      token_coverage: 1,
      passed: true,
    };
  }

  const normalizedActual = normalizeText(actualText);
  const normalizedExpected = normalizeText(expectedText);
  const exactMatch =
    normalizedExpected.length > 0 &&
    normalizedActual.includes(normalizedExpected);
  const tokenCoverage = computeTokenCoverage(actualText, expectedText);
  return {
    applicable: true,
    exact_match: exactMatch,
    token_coverage: tokenCoverage,
    passed: exactMatch || tokenCoverage >= 0.6,
  };
}

function looksLikeClarification(text: string): boolean {
  return (
    /[?？]/.test(text) ||
    /(请问|请补充|请先告诉我|请告诉我|请先确认|请确认|能否|方便|哪台|哪个|哪一个|哪条|什么时间|what|which|where|when|could you|can you|please tell me|please confirm)/i.test(
      text,
    )
  );
}

function getExpectedMode(testCase: GoldenTestCase): ExpectedMode {
  if (testCase.expected_mode) {
    return testCase.expected_mode;
  }
  return testCase.expected_first_step === "direct_answer"
    ? "direct_answer"
    : "clarify_then_answer";
}

function getResponseContractDefaults(
  dataset: GoldenDatasetFile,
): ResponseContractDefaults {
  return {
    ...DEFAULT_RESPONSE_CONTRACT,
    ...dataset.response_contract_defaults,
    required_sections:
      dataset.response_contract_defaults?.required_sections ??
      DEFAULT_RESPONSE_CONTRACT.required_sections,
    required_escalation_keywords:
      dataset.response_contract_defaults?.required_escalation_keywords ??
      DEFAULT_RESPONSE_CONTRACT.required_escalation_keywords,
  };
}

function extractAnswerSections(text: string): AnswerSectionMap {
  const positions = ANSWER_SECTION_TITLES.map((title) => ({
    title,
    index: text.indexOf(title),
  }))
    .filter(
      (
        match,
      ): match is {
        title: (typeof ANSWER_SECTION_TITLES)[number];
        index: number;
      } => match.index >= 0,
    )
    .sort((left, right) => left.index - right.index);

  const sections: AnswerSectionMap = {};
  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index];
    const next = positions[index + 1];
    const start = current.index + current.title.length;
    const end = next ? next.index : text.length;
    sections[current.title] = text
      .slice(start, end)
      .replace(/^[#\s:：-]+/, "")
      .trim();
  }

  return sections;
}

function evaluateKeywords(
  text: string,
  keywords: string[],
  minimumMatches = 1,
): KeywordCheck {
  const uniqueKeywords = [...new Set(keywords.filter(Boolean))];
  if (uniqueKeywords.length === 0) {
    return {
      matched_keywords: [],
      missing_keywords: [],
      passed: true,
    };
  }

  const normalizedText = normalizeText(text);
  const matchedKeywords = uniqueKeywords.filter((keyword) =>
    normalizedText.includes(normalizeText(keyword)),
  );

  return {
    matched_keywords: matchedKeywords,
    missing_keywords: uniqueKeywords.filter(
      (keyword) => !matchedKeywords.includes(keyword),
    ),
    passed:
      matchedKeywords.length >= Math.min(minimumMatches, uniqueKeywords.length),
  };
}

function evaluateForbiddenKeywords(
  text: string,
  keywords: string[],
): AbsenceCheck {
  const uniqueKeywords = [...new Set(keywords.filter(Boolean))];
  if (uniqueKeywords.length === 0) {
    return {
      found_forbidden_keywords: [],
      passed: true,
    };
  }

  const normalizedText = normalizeText(text);
  const foundForbiddenKeywords = uniqueKeywords.filter((keyword) =>
    normalizedText.includes(normalizeText(keyword)),
  );

  return {
    found_forbidden_keywords: foundForbiddenKeywords,
    passed: foundForbiddenKeywords.length === 0,
  };
}

function inspectAnswerContract(text: string) {
  const sections = extractAnswerSections(text);
  const presentSections = ANSWER_SECTION_TITLES.filter((title) =>
    Boolean(sections[title]),
  );
  const observedMode =
    presentSections.length > 0
      ? "structured_answer"
      : looksLikeClarification(text)
        ? "clarification"
        : "unstructured_answer";

  return {
    observed_mode: observedMode,
    present_sections: presentSections,
    has_all_sections: presentSections.length === ANSWER_SECTION_TITLES.length,
    sections,
  };
}

function evaluateFirstStep(text: string, testCase: GoldenTestCase) {
  const clarificationExpected =
    testCase.expected_first_step !== "direct_answer";
  const componentCheck = evaluateField(
    text,
    testCase.correct_answer.component_name,
  );
  const failureCheck = evaluateField(
    text,
    testCase.correct_answer.failure_reason,
  );
  const handlingCheck = evaluateField(
    text,
    testCase.correct_answer.handling_steps,
  );
  const answerSignal =
    componentCheck.passed || failureCheck.passed || handlingCheck.passed;
  const observedClarification = looksLikeClarification(text);

  return {
    passed: clarificationExpected ? observedClarification : answerSignal,
    clarification_expected: clarificationExpected,
    observed_clarification: observedClarification,
    answer_signal: answerSignal,
  };
}

function evaluateFinalAnswer(text: string, answer: GoldenAnswer) {
  const componentCheck = evaluateField(text, answer.component_name);
  const failureCheck = evaluateField(text, answer.failure_reason);
  const handlingCheck = evaluateField(text, answer.handling_steps);
  return {
    passed:
      componentCheck.passed && (failureCheck.passed || handlingCheck.passed),
    component: componentCheck,
    failure_reason: failureCheck,
    handling_steps: handlingCheck,
  };
}

function serializeError(error: unknown): { message: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

function evaluateModeV2(
  testCase: GoldenTestCase,
  firstTurnContract: ReturnType<typeof inspectAnswerContract>,
  finalTurnContract: ReturnType<typeof inspectAnswerContract>,
) {
  const expectedMode = getExpectedMode(testCase);
  const passed =
    expectedMode === "direct_answer"
      ? firstTurnContract.observed_mode === "structured_answer" &&
        firstTurnContract.has_all_sections
      : firstTurnContract.observed_mode === "clarification" &&
        !firstTurnContract.has_all_sections &&
        finalTurnContract.observed_mode === "structured_answer" &&
        finalTurnContract.has_all_sections;

  return {
    expected_mode: expectedMode,
    observed_first_turn_mode: firstTurnContract.observed_mode,
    observed_final_turn_mode: finalTurnContract.observed_mode,
    passed,
  };
}

function evaluateFirstTurnFocus(
  testCase: GoldenTestCase,
  firstTurnText: string,
) {
  const expectedMode = getExpectedMode(testCase);
  const requiredKeywordCheck = evaluateKeywords(
    firstTurnText,
    testCase.required_first_turn_keywords ?? [],
    testCase.required_first_turn_keyword_matches ?? 1,
  );
  const forbiddenKeywordCheck = evaluateForbiddenKeywords(
    firstTurnText,
    testCase.forbidden_first_turn_keywords ?? [],
  );
  const applies =
    expectedMode === "clarify_then_answer" &&
    ((testCase.required_first_turn_keywords?.length ?? 0) > 0 ||
      (testCase.forbidden_first_turn_keywords?.length ?? 0) > 0);

  return {
    applies,
    passed:
      !applies || (requiredKeywordCheck.passed && forbiddenKeywordCheck.passed),
    required_keywords: testCase.required_first_turn_keywords ?? [],
    required_keyword_check: requiredKeywordCheck,
    forbidden_keyword_check: forbiddenKeywordCheck,
  };
}

function evaluateHistoricalFactsSection(
  sectionText: string | undefined,
  testCase: GoldenTestCase,
  defaults: ResponseContractDefaults,
): SectionCheck {
  const requiredKeywords =
    testCase.required_historical_fact_keywords ??
    [
      testCase.reference_context.factory,
      testCase.reference_context.process_or_station,
      testCase.reference_context.anomaly_description,
    ].filter(Boolean);
  const markerCheck = evaluateKeywords(
    sectionText ?? "",
    HISTORICAL_GROUNDING_MARKERS,
    1,
  );
  const keywordCheck = evaluateKeywords(sectionText ?? "", requiredKeywords, 1);

  return {
    section_present: Boolean(sectionText?.trim()),
    keyword_check: keywordCheck,
    passed:
      Boolean(sectionText?.trim()) &&
      (!defaults.require_historical_fact_grounding ||
        markerCheck.passed ||
        evaluateKeywords(
          sectionText ?? "",
          requiredKeywords,
          testCase.required_historical_fact_keyword_matches ?? 1,
        ).passed),
  };
}

function evaluateSuspectedDirectionSection(
  sectionText: string | undefined,
  testCase: GoldenTestCase,
  defaults: ResponseContractDefaults,
): SectionCheck {
  const markerCheck = evaluateKeywords(
    sectionText ?? "",
    SUSPECTED_DIRECTION_MARKERS,
    1,
  );
  const keywordCheck = evaluateKeywords(
    sectionText ?? "",
    testCase.acceptable_suspected_direction_keywords ?? [],
    testCase.acceptable_suspected_direction_keyword_matches ?? 1,
  );

  return {
    section_present: Boolean(sectionText?.trim()),
    keyword_check: {
      matched_keywords: [
        ...markerCheck.matched_keywords,
        ...keywordCheck.matched_keywords,
      ],
      missing_keywords: keywordCheck.missing_keywords,
      passed: markerCheck.passed && keywordCheck.passed,
    },
    passed:
      Boolean(sectionText?.trim()) &&
      (!defaults.require_suspected_direction_hedging || markerCheck.passed) &&
      keywordCheck.passed,
  };
}

function evaluateRecommendedActionSection(
  sectionText: string | undefined,
  testCase: GoldenTestCase,
  defaults: ResponseContractDefaults,
): SectionCheck {
  const requiredKeywords =
    testCase.required_recommended_action_keywords ??
    (isComparableExpectedValue(testCase.correct_answer.handling_steps)
      ? [testCase.correct_answer.handling_steps]
      : []);
  const markerCheck = evaluateKeywords(
    sectionText ?? "",
    RECOMMENDED_ACTION_MARKERS,
    1,
  );
  const keywordCheck = evaluateKeywords(sectionText ?? "", requiredKeywords, 1);

  return {
    section_present: Boolean(sectionText?.trim()),
    keyword_check: keywordCheck,
    passed:
      Boolean(sectionText?.trim()) &&
      (!defaults.require_recommended_action_section ||
        markerCheck.passed ||
        evaluateKeywords(
          sectionText ?? "",
          requiredKeywords,
          testCase.required_recommended_action_keyword_matches ?? 1,
        ).passed),
  };
}

function evaluateEscalationSection(
  sectionText: string | undefined,
  testCase: GoldenTestCase,
  defaults: ResponseContractDefaults,
): SectionCheck {
  const keywordCheck = evaluateKeywords(
    sectionText ?? "",
    testCase.required_escalation_keywords ??
      defaults.required_escalation_keywords,
    testCase.required_escalation_keyword_matches ?? 1,
  );

  return {
    section_present: Boolean(sectionText?.trim()),
    keyword_check: keywordCheck,
    passed:
      Boolean(sectionText?.trim()) &&
      (!defaults.require_escalation_section || keywordCheck.passed),
  };
}

function evaluateResponseV2(
  testCase: GoldenTestCase,
  defaults: ResponseContractDefaults,
  firstTurnText: string,
  finalTurnText: string,
  firstTurnContract: ReturnType<typeof inspectAnswerContract>,
  finalTurnContract: ReturnType<typeof inspectAnswerContract>,
) {
  const finalSections = finalTurnContract.sections;
  const modeCheck = evaluateModeV2(
    testCase,
    firstTurnContract,
    finalTurnContract,
  );
  const firstTurnFocusCheck = evaluateFirstTurnFocus(testCase, firstTurnText);
  const contractCheck = {
    passed: defaults.required_sections.every((title) =>
      finalTurnContract.present_sections.includes(
        title as (typeof ANSWER_SECTION_TITLES)[number],
      ),
    ),
    required_sections: defaults.required_sections,
    present_sections: finalTurnContract.present_sections,
  };
  const historicalFactsCheck = evaluateHistoricalFactsSection(
    finalSections["历史案例事实"],
    testCase,
    defaults,
  );
  const suspectedDirectionCheck = evaluateSuspectedDirectionSection(
    finalSections["当前怀疑方向"],
    testCase,
    defaults,
  );
  const recommendedActionCheck = evaluateRecommendedActionSection(
    finalSections["建议先做的检查或操作"],
    testCase,
    defaults,
  );
  const escalationCheck = evaluateEscalationSection(
    finalSections["何时升级给维修工程师"],
    testCase,
    defaults,
  );
  const forbiddenClaimCheck = evaluateForbiddenKeywords(
    finalTurnText,
    testCase.forbidden_claim_keywords ?? [],
  );

  return {
    passed:
      modeCheck.passed &&
      firstTurnFocusCheck.passed &&
      contractCheck.passed &&
      historicalFactsCheck.passed &&
      suspectedDirectionCheck.passed &&
      recommendedActionCheck.passed &&
      escalationCheck.passed &&
      forbiddenClaimCheck.passed,
    mode_check: modeCheck,
    first_turn_focus_check: firstTurnFocusCheck,
    contract_check: contractCheck,
    historical_facts_check: historicalFactsCheck,
    suspected_direction_check: suspectedDirectionCheck,
    recommended_action_check: recommendedActionCheck,
    escalation_check: escalationCheck,
    forbidden_claim_check: forbiddenClaimCheck,
  };
}

function summarizeDatasetResults(
  caseResults: Array<{
    error?: { message: string };
    legacy_final_answer_check?: { passed: boolean };
    final_turn_contract?: { has_all_sections: boolean; observed_mode: string };
    response_v2_check?: {
      contract_check: { passed: boolean };
      escalation_check: { passed: boolean };
      first_turn_focus_check: { passed: boolean };
      forbidden_claim_check: { passed: boolean };
      historical_facts_check: { passed: boolean };
      mode_check: { passed: boolean };
      passed: boolean;
      recommended_action_check: { passed: boolean };
      suspected_direction_check: { passed: boolean };
    };
  }>,
) {
  const totals = {
    cases: caseResults.length,
    errors: 0,
    mode_passed: 0,
    first_turn_focus_passed: 0,
    contract_passed: 0,
    historical_facts_passed: 0,
    suspected_direction_passed: 0,
    recommended_action_passed: 0,
    escalation_passed: 0,
    forbidden_claim_passed: 0,
    fully_passed: 0,
    structured_final_answers: 0,
    legacy_final_answer_passed: 0,
  };

  for (const result of caseResults) {
    if (result.error) {
      totals.errors += 1;
      continue;
    }
    if (result.response_v2_check?.mode_check.passed) {
      totals.mode_passed += 1;
    }
    if (result.response_v2_check?.first_turn_focus_check.passed) {
      totals.first_turn_focus_passed += 1;
    }
    if (result.response_v2_check?.contract_check.passed) {
      totals.contract_passed += 1;
    }
    if (result.response_v2_check?.historical_facts_check.passed) {
      totals.historical_facts_passed += 1;
    }
    if (result.response_v2_check?.suspected_direction_check.passed) {
      totals.suspected_direction_passed += 1;
    }
    if (result.response_v2_check?.recommended_action_check.passed) {
      totals.recommended_action_passed += 1;
    }
    if (result.response_v2_check?.escalation_check.passed) {
      totals.escalation_passed += 1;
    }
    if (result.response_v2_check?.forbidden_claim_check.passed) {
      totals.forbidden_claim_passed += 1;
    }
    if (result.response_v2_check?.passed) {
      totals.fully_passed += 1;
    }
    if (result.final_turn_contract?.has_all_sections) {
      totals.structured_final_answers += 1;
    }
    if (result.legacy_final_answer_check?.passed) {
      totals.legacy_final_answer_passed += 1;
    }
  }

  return totals;
}

async function runCaseRegression(
  openai: ReturnType<typeof createProjectAndOpenAIClient>["openai"],
  agentName: string,
  testCase: GoldenTestCase,
  defaults: ResponseContractDefaults,
) {
  const conversation = await openai.conversations.create();

  try {
    const firstResponse = await runAgentTurn(
      conversation.id,
      agentName,
      openai,
      testCase.initial_user_input,
    );
    const firstTurnText = firstResponse.output_text || "";

    let finalTurnText = firstTurnText;
    let secondTurnText: string | null = null;
    if (testCase.follow_up_user_reply?.trim()) {
      const followUpResponse = await runAgentTurn(
        conversation.id,
        agentName,
        openai,
        testCase.follow_up_user_reply,
      );
      secondTurnText = followUpResponse.output_text || "";
      finalTurnText = secondTurnText;
    }

    const firstStepCheck = evaluateFirstStep(firstTurnText, testCase);
    const legacyFinalAnswerCheck = evaluateFinalAnswer(
      finalTurnText,
      testCase.correct_answer,
    );
    const firstTurnContract = inspectAnswerContract(firstTurnText);
    const finalTurnContract = inspectAnswerContract(finalTurnText);
    const responseV2Check = evaluateResponseV2(
      testCase,
      defaults,
      firstTurnText,
      finalTurnText,
      firstTurnContract,
      finalTurnContract,
    );

    return {
      golden_test_id: testCase.golden_test_id,
      source_case_id: testCase.source_case_id,
      scenario_type: testCase.scenario_type,
      expected_mode: getExpectedMode(testCase),
      expected_first_step: testCase.expected_first_step,
      first_turn_text: firstTurnText,
      second_turn_text: secondTurnText,
      final_turn_text: finalTurnText,
      first_turn_contract: firstTurnContract,
      final_turn_contract: finalTurnContract,
      legacy_first_step_check: firstStepCheck,
      legacy_final_answer_check: legacyFinalAnswerCheck,
      response_v2_check: responseV2Check,
      passed: responseV2Check.passed,
    };
  } catch (error) {
    return {
      golden_test_id: testCase.golden_test_id,
      source_case_id: testCase.source_case_id,
      scenario_type: testCase.scenario_type,
      expected_mode: getExpectedMode(testCase),
      expected_first_step: testCase.expected_first_step,
      error: serializeError(error),
      passed: false,
    };
  } finally {
    await openai.conversations.delete(conversation.id);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(process.cwd(), options.manifestPath);
  const manifest = await loadJsonFile<ManifestFile>(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const baseDir = path.resolve(manifestDir, manifest.base_path ?? ".");

  const selectedEntries = manifest.datasets.filter((entry) => {
    if (options.datasetIds.length > 0) {
      return options.datasetIds.includes(entry.dataset_id);
    }
    if (options.includeFull) {
      return true;
    }
    return entry.role === "regression_split";
  });

  if (selectedEntries.length === 0) {
    throw new Error("No datasets selected from the manifest.");
  }

  const datasetPlans = [] as Array<{
    dataset: GoldenDatasetFile;
    entry: ManifestDatasetEntry;
    filePath: string;
    selectedCaseCount: number;
    selectedCases: GoldenTestCase[];
  }>;

  for (const entry of selectedEntries) {
    const datasetPath = path.resolve(baseDir, entry.file);
    const dataset = await loadJsonFile<GoldenDatasetFile>(datasetPath);
    if (dataset.test_case_count !== entry.test_case_count) {
      throw new Error(
        `${entry.dataset_id} count mismatch: manifest=${entry.test_case_count}, dataset=${dataset.test_case_count}`,
      );
    }

    const selectedCases =
      options.maxCasesPerDataset === null
        ? dataset.test_cases
        : dataset.test_cases.slice(0, options.maxCasesPerDataset);

    datasetPlans.push({
      entry,
      dataset,
      filePath: datasetPath,
      selectedCases,
      selectedCaseCount: selectedCases.length,
    });
  }

  const report: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    manifest: {
      path: manifestPath,
      manifest_name: manifest.manifest_name,
      manifest_version: manifest.manifest_version,
      authoritative_dataset_id: manifest.authoritative_dataset_id ?? null,
    },
    mode: options.dryRun ? "dry_run" : "live",
    selected_dataset_ids: datasetPlans.map((plan) => plan.entry.dataset_id),
    datasets: datasetPlans.map((plan) => ({
      dataset_id: plan.entry.dataset_id,
      dataset_name: plan.dataset.dataset_name,
      evaluation_target: plan.dataset.evaluation_target ?? null,
      evaluation_version: plan.dataset.evaluation_version ?? null,
      file: plan.filePath,
      split_type: plan.entry.split_type,
      role: plan.entry.role,
      total_cases: plan.dataset.test_case_count,
      selected_cases: plan.selectedCaseCount,
    })),
  };

  if (options.dryRun) {
    const outputPath = path.resolve(process.cwd(), options.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const runtime = createTroubleshootingRuntime();
  const { project, openai } = createProjectAndOpenAIClient(runtime);
  const agent = await createTroubleshootingAgent(project, runtime);

  console.log(
    `Created regression agent version: ${agent.name}@${agent.version}`,
  );

  const datasetResults = [] as Array<Record<string, unknown>>;
  try {
    for (const plan of datasetPlans) {
      console.log(
        `Running dataset ${plan.entry.dataset_id} (${plan.selectedCaseCount} cases)...`,
      );
      const responseContractDefaults = getResponseContractDefaults(
        plan.dataset,
      );
      const caseResults = [] as Array<Record<string, unknown>>;
      for (const testCase of plan.selectedCases) {
        console.log(`  - ${testCase.golden_test_id}`);
        caseResults.push(
          await runCaseRegression(
            openai,
            agent.name,
            testCase,
            responseContractDefaults,
          ),
        );
      }

      datasetResults.push({
        dataset_id: plan.entry.dataset_id,
        dataset_name: plan.dataset.dataset_name,
        evaluation_target: plan.dataset.evaluation_target ?? null,
        evaluation_version: plan.dataset.evaluation_version ?? null,
        file: plan.filePath,
        split_type: plan.entry.split_type,
        role: plan.entry.role,
        total_cases: plan.dataset.test_case_count,
        selected_cases: plan.selectedCaseCount,
        summary: summarizeDatasetResults(
          caseResults as Array<{
            error?: { message: string };
            legacy_final_answer_check?: { passed: boolean };
            response_v2_check?: {
              contract_check: { passed: boolean };
              escalation_check: { passed: boolean };
              first_turn_focus_check: { passed: boolean };
              forbidden_claim_check: { passed: boolean };
              historical_facts_check: { passed: boolean };
              mode_check: { passed: boolean };
              passed: boolean;
              recommended_action_check: { passed: boolean };
              suspected_direction_check: { passed: boolean };
            };
          }>,
        ),
        case_results: caseResults,
      });
    }
  } finally {
    if (shouldDeleteAgentVersion()) {
      await project.agents.deleteVersion(agent.name, agent.version);
      console.log(
        `Deleted regression agent version: ${agent.name}@${agent.version}`,
      );
    } else {
      console.log(
        `Retained regression agent version: ${agent.name}@${agent.version}`,
      );
    }
  }

  report.runtime = {
    agent_name: agent.name,
    model_deployment: runtime.modelDeployment,
    mcp_server_url: runtime.mcpServerUrl,
    search_index_name: runtime.searchIndexName,
  };
  report.datasets = datasetResults;
  report.summary = {
    datasets: datasetResults.length,
    cases: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { cases: number };
      return total + summary.cases;
    }, 0),
    mode_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { mode_passed: number };
      return total + summary.mode_passed;
    }, 0),
    first_turn_focus_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { first_turn_focus_passed: number };
      return total + summary.first_turn_focus_passed;
    }, 0),
    contract_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { contract_passed: number };
      return total + summary.contract_passed;
    }, 0),
    historical_facts_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { historical_facts_passed: number };
      return total + summary.historical_facts_passed;
    }, 0),
    suspected_direction_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { suspected_direction_passed: number };
      return total + summary.suspected_direction_passed;
    }, 0),
    recommended_action_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { recommended_action_passed: number };
      return total + summary.recommended_action_passed;
    }, 0),
    escalation_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { escalation_passed: number };
      return total + summary.escalation_passed;
    }, 0),
    forbidden_claim_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { forbidden_claim_passed: number };
      return total + summary.forbidden_claim_passed;
    }, 0),
    fully_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { fully_passed: number };
      return total + summary.fully_passed;
    }, 0),
    structured_final_answers: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { structured_final_answers: number };
      return total + summary.structured_final_answers;
    }, 0),
    legacy_final_answer_passed: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { legacy_final_answer_passed: number };
      return total + summary.legacy_final_answer_passed;
    }, 0),
    errors: datasetResults.reduce((total, dataset) => {
      const summary = dataset.summary as { errors: number };
      return total + summary.errors;
    }, 0),
  };

  const outputPath = path.resolve(process.cwd(), options.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("Manifest regression runner failed.");
  console.error(error);
  process.exitCode = 1;
});
