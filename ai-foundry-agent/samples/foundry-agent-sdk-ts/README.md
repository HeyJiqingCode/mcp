# Foundry Agent SDK TypeScript Sample

This sample creates a Microsoft Foundry prompt agent with a remote MCP tool and runs it as a multi-turn troubleshooting assistant.

## Prerequisites

- Node.js 20+
- Azure credentials available to `DefaultAzureCredential`
- Access to the Foundry project

The sample is preconfigured for:

- Project endpoint: `https://lee1-mi4d91kb-eastus2.services.ai.azure.com/api/projects/lee1-mi4d91kb-eastus2_project`
- Model deployment: `gpt-5.4-1`
- MCP endpoint: `http://20.205.26.133/azure-search-mcp`
- Troubleshooting search index: `suzhou-factory-ai-troubleshooting-v1`
- Semantic configuration: `sem-default`
- Vector field: `query_context_vector`
- Returned grounding fields: `factory,machine_model,process_or_station,component_name,event_start_at,anomaly_description,failure_reason,handling_steps,case_title,resolution_summary_text`

The index name is legacy and still contains multi-factory troubleshooting data, not only Suzhou cases.

## Setup

```bash
cd samples/foundry-agent-sdk-ts
cp .env.example .env
npm install
```

You can authenticate in either of these ways:

- interactive developer login via Azure CLI
- service principal values in `.env` via `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`

If you are using interactive developer credentials, sign in first:

```bash
az login
```

## Run

```bash
npm run start
```

By default the sample starts an interactive conversation and waits for the user to describe the fault.

- If the description is incomplete, the agent should ask a natural follow-up question for the next most valuable detail.
- If you want a scripted one-shot run instead, set `FOUNDRY_INTERACTIVE=false` and provide `FOUNDRY_TEST_PROMPT`.

## Build

```bash
npm run build
```

## Regression Runner

Use the lightweight manifest runner when you want to batch through the golden regression datasets from RMSRAG.

Dry-run the manifest traversal without calling Foundry:

```bash
npm run regression:dry-run -- "C:\path\to\golden_test_cases.manifest.json"
```

Run the live regression loop and write a JSON report:

```bash
npm run regression -- "C:\path\to\golden_test_cases.manifest.json" "tmp\regression-report.json"
```

Notes:

- By default the runner executes the manifest entries whose `role` is `regression_split`, so it skips the full authoritative dataset unless you explicitly target it.
- The runner supports direct CLI flags such as `--dataset`, `--include-full`, `--max-cases`, and `--output` when you invoke `node --import tsx ./src/runManifestRegression.ts` directly.
- The generated report includes the raw assistant text for each turn plus lightweight heuristic checks for first-step clarification behavior and final grounded answer coverage.

## Notes

- `MCP_REQUIRE_APPROVAL=never` keeps the sample simple for the unauthenticated MCP endpoint.
- `FOUNDRY_DELETE_AGENT_VERSION=true` deletes the created agent version after the test run finishes.
- `FOUNDRY_INTERACTIVE=true` is the default mode. In this mode, `FOUNDRY_TEST_PROMPT` is optional; if you leave it empty, the CLI waits for the user to type the first question.
- In interactive mode, the agent should behave like a troubleshooting engineer: give a brief working hypothesis, ask only the most valuable missing question first, and continue the conversation until there is enough evidence to retrieve grounded cases.
- The sample instructions explicitly steer the agent to `semantic_hybrid_search` with the validated index, semantic configuration, vector field, and grounding fields.
- The retrieval logic is no longer Suzhou-only. The agent should use the factory from the employee question as the primary exact filter, then combine machine model, process or station, incident time, and anomaly description to narrow and explain candidate cases.
- If the user only provides a machine family label such as `Contura`, the agent should keep that label in the retrieval query instead of applying a wrong exact `machine_model` filter.
- If incident time is provided, the agent should use it as evidence and, when safe, as an `event_start_at` filter to avoid relying on later cases.
- The remote MCP endpoint is currently HTTP. That is acceptable for local validation, but a production Foundry rollout should move to HTTPS.
