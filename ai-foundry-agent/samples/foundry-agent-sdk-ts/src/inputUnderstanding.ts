import type { TroubleContext } from "./types.js";

type PatternMap = {
  normalized: string;
  variants: RegExp[];
};

const FACTORY_PATTERNS: PatternMap[] = [
  { normalized: "Oberkochen", variants: [/oberkochen/i] },
  { normalized: "Minneapolis", variants: [/minneapolis/i] },
  { normalized: "Bangalore", variants: [/bangalore/i] },
  { normalized: "Suzhou", variants: [/suzhou/i, /苏州/] },
];

const EQUIPMENT_PATTERNS: PatternMap[] = [
  { normalized: "Contura", variants: [/contura/i] },
  { normalized: "Integration", variants: [/integration/i, /集成/] },
  { normalized: "Prismo", variants: [/prismo/i] },
  { normalized: "CMM", variants: [/\bcmm\b/i] },
];

const SYMPTOM_PATTERNS: PatternMap[] = [
  {
    normalized: "Antriebe gehen nicht ein",
    variants: [
      /antriebe\s+gehen\s+nicht\s+ein/i,
      /驱动.*进不去/,
      /驱动.*使能.*不上/,
      /使能.*进不去/,
      /drives?\s+(won't|will not|do not|don't)\s+enable/i,
    ],
  },
];

const STATION_PATTERNS: PatternMap[] = [
  { normalized: "Lasering", variants: [/lasering/i] },
  {
    normalized: "Install shrouds",
    variants: [/install\s+shrouds/i, /装\s*shroud/i, /装\s*shrouds/i],
  },
  { normalized: "UESA", variants: [/\buesa\b/i] },
  { normalized: "Loading", variants: [/loading/i, /上料/] },
  { normalized: "Unloading", variants: [/unloading/i, /下料/] },
  {
    normalized: "Drive enable",
    variants: [
      /drive\s+(will\s+not\s+)?enable/i,
      /驱动进不去/,
      /使能不上/,
      /使能进不去/,
    ],
  },
];

const ACTION_PATTERNS: PatternMap[] = [
  { normalized: "enable", variants: [/enable/i, /使能/] },
  { normalized: "reset", variants: [/reset/i, /复位/] },
  { normalized: "alarm", variants: [/alarm/i, /报警/] },
  { normalized: "stop", variants: [/stop/i, /停机/, /停止/] },
  {
    normalized: "cannot_start",
    variants: [/cannot\s+start/i, /can't\s+start/i, /启动不了/, /无法启动/],
  },
  {
    normalized: "not_move",
    variants: [/not\s+move/i, /won't\s+move/i, /不动作/, /不动/],
  },
];

const EFFECT_PATTERNS: PatternMap[] = [
  { normalized: "trip", variants: [/trip/i, /跳闸/, /跳了/] },
  {
    normalized: "scraping",
    variants: [/scrap/i, /rub/i, /streift/i, /摩擦/, /刮擦/],
  },
  { normalized: "dragging", variants: [/drag/i, /拖地/, /下垂/] },
  { normalized: "abnormal_noise", variants: [/noise/i, /响声/, /异响/] },
];

const QUOTED_PHRASE_REGEX = /["“](.+?)["”]/g;
const ALARM_CODE_REGEX = /\b[A-Z]{1,5}\d{1,4}\b/g;

function firstNormalizedMatch(
  text: string,
  patterns: PatternMap[],
): string | undefined {
  return patterns.find((pattern) =>
    pattern.variants.some((variant) => variant.test(text)),
  )?.normalized;
}

function collectNormalizedMatches(
  text: string,
  patterns: PatternMap[],
): string[] {
  return patterns
    .filter((pattern) => pattern.variants.some((variant) => variant.test(text)))
    .map((pattern) => pattern.normalized);
}

function collectQuotedPhrases(text: string): string[] {
  const phrases: string[] = [];
  for (const match of text.matchAll(QUOTED_PHRASE_REGEX)) {
    const value = match[1]?.trim();
    if (value) {
      phrases.push(value);
    }
  }
  return phrases;
}

function collectAlarmCodes(text: string): string[] {
  return [...new Set(text.match(ALARM_CODE_REGEX) ?? [])];
}

function inferNormalizedSymptom(
  rawUserMessage: string,
  preservedKeywords: string[],
  observedEffects: string[],
): string | undefined {
  const canonicalSymptom = firstNormalizedMatch(
    rawUserMessage,
    SYMPTOM_PATTERNS,
  );
  if (canonicalSymptom) {
    return canonicalSymptom;
  }
  if (preservedKeywords.length > 0) {
    return preservedKeywords[0];
  }
  if (observedEffects.length > 0) {
    return observedEffects.join(", ");
  }

  const compact = rawUserMessage.replace(/\s+/g, " ").trim();
  if (compact.length >= 8) {
    return compact.slice(0, 160);
  }
  return undefined;
}

function inferConfidence(
  factory: string | undefined,
  normalizedSymptom: string | undefined,
  alarmCodes: string[],
  preservedKeywords: string[],
): TroubleContext["confidence"] {
  if (factory && (normalizedSymptom || alarmCodes.length > 0)) {
    return "high";
  }
  if (factory || normalizedSymptom || preservedKeywords.length > 0) {
    return "medium";
  }
  return "low";
}

export function understandTroubleContext(
  rawUserMessage: string,
): TroubleContext {
  const factory = firstNormalizedMatch(rawUserMessage, FACTORY_PATTERNS);
  const equipment = firstNormalizedMatch(rawUserMessage, EQUIPMENT_PATTERNS);
  const station = firstNormalizedMatch(rawUserMessage, STATION_PATTERNS);
  const actionState = collectNormalizedMatches(rawUserMessage, ACTION_PATTERNS);
  const observedEffects = collectNormalizedMatches(
    rawUserMessage,
    EFFECT_PATTERNS,
  );
  const preservedKeywords = [
    ...collectQuotedPhrases(rawUserMessage),
    ...collectAlarmCodes(rawUserMessage),
    ...actionState,
    ...observedEffects,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  const alarmCodes = collectAlarmCodes(rawUserMessage);
  const normalizedSymptom = inferNormalizedSymptom(
    rawUserMessage,
    preservedKeywords,
    observedEffects,
  );

  const missingCriticalSlots: string[] = [];
  if (!factory) {
    missingCriticalSlots.push("factory");
  }
  if (!normalizedSymptom) {
    missingCriticalSlots.push("symptom");
  }

  return {
    rawUserMessage,
    normalizedSymptom,
    factory,
    line: undefined,
    station,
    equipment,
    actionState,
    alarmCodes,
    observedEffects,
    missingCriticalSlots,
    preservedKeywords,
    confidence: inferConfidence(
      factory,
      normalizedSymptom,
      alarmCodes,
      preservedKeywords,
    ),
  };
}
