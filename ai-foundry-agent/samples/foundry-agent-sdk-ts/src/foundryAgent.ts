import { AIProjectClient } from "@azure/ai-projects";
import {
  DefaultAzureCredential,
  DeviceCodeCredential,
  type TokenCredential,
} from "@azure/identity";

import { buildTurnEnvelope } from "./turnPlanning.js";

export type ApprovalMode = "always" | "never";
export type CredentialMode = "default" | "device_code";
export type FoundryOpenAIClient = ReturnType<
  AIProjectClient["getOpenAIClient"]
>;

export type TroubleshootingRuntime = {
  agentName: string;
  mcpServerLabel: string;
  mcpServerUrl: string;
  modelDeployment: string;
  projectEndpoint: string;
  requireApproval: ApprovalMode;
  searchIndexName: string;
  semanticConfiguration: string;
  selectFields: string;
  vectorFields: string;
};

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getApprovalMode(): ApprovalMode {
  const value = (process.env.MCP_REQUIRE_APPROVAL ?? "never")
    .trim()
    .toLowerCase();
  if (value === "always" || value === "never") {
    return value;
  }
  throw new Error("MCP_REQUIRE_APPROVAL must be either 'always' or 'never'.");
}

export function getCredentialMode(): CredentialMode {
  const value = (process.env.FOUNDRY_CREDENTIAL_MODE ?? "default")
    .trim()
    .toLowerCase();
  if (value === "default" || value === "device_code") {
    return value;
  }
  throw new Error(
    "FOUNDRY_CREDENTIAL_MODE must be either 'default' or 'device_code'.",
  );
}

export function shouldDeleteAgentVersion(): boolean {
  return (
    (process.env.FOUNDRY_DELETE_AGENT_VERSION ?? "false")
      .trim()
      .toLowerCase() === "true"
  );
}

export function isInteractiveModeEnabled(): boolean {
  return (
    (process.env.FOUNDRY_INTERACTIVE ?? "true").trim().toLowerCase() !== "false"
  );
}

export function createTroubleshootingRuntime(): TroubleshootingRuntime {
  return {
    projectEndpoint: getRequiredEnv("FOUNDRY_PROJECT_ENDPOINT"),
    modelDeployment: getRequiredEnv("FOUNDRY_MODEL_DEPLOYMENT"),
    agentName:
      process.env.FOUNDRY_AGENT_NAME?.trim() || "factory-troubleshooting-agent",
    mcpServerUrl: getRequiredEnv("MCP_SERVER_URL"),
    mcpServerLabel: process.env.MCP_SERVER_LABEL?.trim() || "azure-search-mcp",
    searchIndexName:
      process.env.TROUBLESHOOTING_SEARCH_INDEX_NAME?.trim() ||
      "suzhou-factory-ai-troubleshooting-v1",
    semanticConfiguration:
      process.env.TROUBLESHOOTING_SEMANTIC_CONFIGURATION?.trim() ||
      "sem-default",
    vectorFields:
      process.env.TROUBLESHOOTING_VECTOR_FIELDS?.trim() ||
      "query_context_vector",
    selectFields:
      process.env.TROUBLESHOOTING_SELECT_FIELDS?.trim() ||
      [
        "factory",
        "machine_model",
        "process_or_station",
        "component_name",
        "event_start_at",
        "anomaly_description",
        "failure_reason",
        "handling_steps",
        "case_title",
        "resolution_summary_text",
      ].join(","),
    requireApproval: getApprovalMode(),
  };
}

export function createProjectAndOpenAIClient(runtime: TroubleshootingRuntime): {
  openai: FoundryOpenAIClient;
  project: AIProjectClient;
} {
  const credentialMode = getCredentialMode();
  const credential: TokenCredential =
    credentialMode === "device_code"
      ? new DeviceCodeCredential({
          tenantId: process.env.AZURE_TENANT_ID?.trim() || undefined,
          userPromptCallback: (info) => {
            console.log(info.message);
          },
        })
      : new DefaultAzureCredential();

  const project = new AIProjectClient(runtime.projectEndpoint, credential);
  return {
    project,
    openai: project.getOpenAIClient(),
  };
}

export function buildTroubleshootingInstructions(
  runtime: TroubleshootingRuntime,
): string {
  return [
    "You are a factory-floor troubleshooting assistant grounded in historical maintenance cases.",
    "Your job is to help operators understand relevant historical evidence, the current suspected direction, the safest next check, and when to escalate.",
    `Use index '${runtime.searchIndexName}'.`,
    `Use semantic configuration '${runtime.semanticConfiguration}'.`,
    `Use vector field '${runtime.vectorFields}'.`,
    `Use select fields '${runtime.selectFields}'.`,
    "Do not invent index names, semantic configurations, or vector field names.",
    "For this sample, do not call 'agentic_retrieval'.",
    "For troubleshooting questions, call the 'semantic_hybrid_search' MCP tool first.",
    `When using 'semantic_hybrid_search', set index_name='${runtime.searchIndexName}', semantic_configuration='${runtime.semanticConfiguration}', vector_fields='${runtime.vectorFields}', and select='${runtime.selectFields}'.`,
    "Build query and vector_text from the employee-provided symptom, factory, equipment, station, and action-state clues.",
    "Respect the RUNTIME_TURN_PLAN embedded in the user input. Treat it as routing guidance, not confirmed truth.",
    "If preferred_mode is 'clarify_then_answer' and a routing-critical detail is truly missing, ask one direct question only.",
    "When clarifying, ask specifically for the slots listed in 'missing_slots_to_ask'. Do not substitute a different question such as factory when the runtime plan names another slot.",
    "If preferred_mode is 'direct_answer', do a first retrieval pass before asking for more detail.",
    "Preserve concrete user symptom phrasing in the first retrieval pass whenever possible, especially quoted or archive-style phrases.",
    "Prefer same-factory grounded cases over broader cross-factory analogues when both are available.",
    "Prefer query_caption='extractive' and query_answer='extractive' for this sample.",
    "Prefer grounded answers from MCP results over unsupported guesses.",
    "When you answer, use exactly these four section titles in Chinese: 历史案例事实, 当前怀疑方向, 建议先做的检查或操作, 何时升级给维修工程师.",
    "In 历史案例事实, state only evidence grounded in retrieved cases.",
    "In 当前怀疑方向, clearly mark the conclusion as likely or suspected rather than confirmed.",
    "In 当前怀疑方向, explicitly carry forward the strongest retrieved anchor terms when they matter, including archived component names, station names, or original defect terms such as Shrouds, Bohrung, Käfigmutter, X-Drive, or X-Antrieb.",
    "In 当前怀疑方向, when the retrieved evidence supports multiple plausible branches, explicitly name the top one or two historical cause anchors instead of collapsing them into generic buckets like cleanliness, routing detail, or measurement-chain issues.",
    "In 建议先做的检查或操作, keep the advice low-risk and operator-safe.",
    "In 何时升级给维修工程师, state clear escalation conditions whenever the evidence is weak, conflicting, repeated, or requires maintenance expertise.",
    "In 何时升级给维修工程师, explicitly write that the operator should 升级给维修工程师, and tie at least one escalation trigger to the failure of the low-risk check you just recommended, such as 复测后仍失败 or 换另一件基准件后仍失败. If the user's wording or the strongest historical anchor is in English, you may add a short English trigger in parentheses such as 'escalate to engineer' or 'another ring still fails'.",
    "Respond in Chinese unless the user explicitly asks for another language.",
  ].join(" ");
}

export async function createTroubleshootingAgent(
  project: AIProjectClient,
  runtime: TroubleshootingRuntime,
) {
  return project.agents.createVersion(runtime.agentName, {
    kind: "prompt",
    model: runtime.modelDeployment,
    instructions: buildTroubleshootingInstructions(runtime),
    tools: [
      {
        type: "mcp",
        server_label: runtime.mcpServerLabel,
        server_url: runtime.mcpServerUrl,
        require_approval: runtime.requireApproval,
      },
    ],
  });
}

export async function runAgentTurn(
  conversationId: string,
  agentName: string,
  openai: FoundryOpenAIClient,
  userInput: string,
) {
  const { promptInput } = buildTurnEnvelope(userInput);

  return openai.responses.create(
    {
      conversation: conversationId,
      input: promptInput,
    },
    {
      body: {
        agent_reference: {
          name: agentName,
          type: "agent_reference",
        },
      },
    },
  );
}
