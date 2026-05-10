import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { FoundryOpenAIClient } from "./foundryAgent.js";
import {
  createProjectAndOpenAIClient,
  createTroubleshootingAgent,
  createTroubleshootingRuntime,
  isInteractiveModeEnabled,
  runAgentTurn,
  shouldDeleteAgentVersion,
} from "./foundryAgent.js";

async function runTurn(
  conversationId: string,
  agentName: string,
  openai: FoundryOpenAIClient,
  userInput: string,
): Promise<void> {
  const response = await runAgentTurn(
    conversationId,
    agentName,
    openai,
    userInput,
  );

  console.log("Assistant:");
  console.log(response.output_text || "<empty>");

  console.log("Response items:");
  for (const item of response.output) {
    console.log(JSON.stringify(item, null, 2));
  }
}

async function runInteractiveSession(
  conversationId: string,
  agentName: string,
  openai: FoundryOpenAIClient,
  initialPrompt: string,
): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    const firstInput = initialPrompt || (await rl.question("You: "));
    if (!firstInput.trim()) {
      console.log("No input provided. Exiting interactive session.");
      return;
    }

    await runTurn(conversationId, agentName, openai, firstInput);

    while (true) {
      const nextInput = await rl.question(
        "You (press Enter or type 'exit' to quit): ",
      );
      const normalizedInput = nextInput.trim();

      if (!normalizedInput || normalizedInput.toLowerCase() === "exit") {
        break;
      }

      await runTurn(conversationId, agentName, openai, normalizedInput);
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const runtime = createTroubleshootingRuntime();
  const interactiveMode = isInteractiveModeEnabled();
  const testPrompt = process.env.FOUNDRY_TEST_PROMPT?.trim() ?? "";

  if (!interactiveMode && !testPrompt) {
    throw new Error(
      "FOUNDRY_TEST_PROMPT is required when FOUNDRY_INTERACTIVE=false.",
    );
  }

  const { project, openai } = createProjectAndOpenAIClient(runtime);
  const agent = await createTroubleshootingAgent(project, runtime);

  console.log("Created agent version:");
  console.log(
    JSON.stringify(
      {
        id: agent.id,
        name: agent.name,
        version: agent.version,
      },
      null,
      2,
    ),
  );

  const conversation = await openai.conversations.create();
  console.log(`Conversation created: ${conversation.id}`);

  try {
    if (interactiveMode) {
      console.log(
        "Interactive troubleshooting session started. Describe the fault, then continue answering the agent's follow-up questions. Type 'exit' to finish.",
      );
      await runInteractiveSession(
        conversation.id,
        agent.name,
        openai,
        testPrompt,
      );
    } else {
      await runTurn(conversation.id, agent.name, openai, testPrompt);
    }
  } finally {
    await openai.conversations.delete(conversation.id);
    console.log(`Conversation deleted: ${conversation.id}`);

    if (shouldDeleteAgentVersion()) {
      await project.agents.deleteVersion(agent.name, agent.version);
      console.log(`Agent version deleted: ${agent.name}@${agent.version}`);
    } else {
      console.log(`Agent version retained: ${agent.name}@${agent.version}`);
    }
  }
}

main().catch((error) => {
  console.error("Foundry MCP integration failed.");
  console.error(error);
  process.exitCode = 1;
});
