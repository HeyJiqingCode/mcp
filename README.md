# MCP Server Collection

A collection of multiple Model Context Protocol (MCP) servers.

## Project Overview

This project contains four MCP servers, each focused on specific AI functional areas:

- **[Azure AI Foundry Agent](./ai-foundry-agent/)** - Azure AI Foundry agent management and interaction
- **[Bing Search Agent](./bing-search-agent/)** - Intelligent web search and information retrieval
- **[Deep Research Agent](./deep-research-agent/)** - Deep research and comprehensive analysis
- **[Azure AI Search](./ai-search/)** - Multi-mode retrieval over Azure AI Search (keyword, semantic, vector, and hybrid)

## Project Structure

```
mcp/
├── ai-foundry-agent/           # Azure AI Foundry Agent MCP Server
│   ├── README.md
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── mcp.json
│   └── src/
├── bing-search-agent/          # Bing Search Agent MCP Server
│   ├── README.md
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── mcp.json
│   └── src/
├── deep-research-agent/        # Deep Research Agent MCP Server
│   ├── README.md
│   ├── Dockerfile
│   ├── LICENSE
│   ├── DifyAgent.yml
│   ├── mcp.json
│   └── src/
├── ai-search/                  # Azure AI Search MCP Server
│   ├── README.md
│   ├── Dockerfile
│   ├── LICENSE
│   ├── mcp.json
│   └── src/
└── README.md                    # This file
```

## MCP Server Overview

### AI Foundry Agent

Provides seamless access to intelligent agents built with Azure AI Foundry, supporting agent management, communication, and conversation context maintenance.

**Key Features**: Agent management and discovery, agent communication and interaction, conversation context maintenance, response tracking and citation

**Detailed**: Please refer to [Azure AI Foundry Agent README](./ai-foundry-agent/README.md)

**Step-by-Step Doc:** See [MCP Server for Azure AI Foundry Agent](https://heyjiqing.notion.site/MCP-Server-for-Azure-AI-Foundry-Agent-256de7b6e4e880238e13ce0c359a0bc7)

---

### Bing Search Agent

Provides intelligent web search functionality through Azure AI Foundry Agent integration, supporting AI analysis and result summarization.

**Key Features**: Bing search integration, AI analysis and summarization, automatic citation and source attribution, detailed response metadata

**Detailed**: Please refer to [Bing Search Agent README](./bing-search-agent/README.md)

**Step-by-Step Doc:** See [MCP Server for Grounding with Bing Search](https://heyjiqing.notion.site/MCP-Server-for-Grounding-with-Bing-Search-256de7b6e4e8806d8fcaf555b8b8126e)

---

### Deep Research Agent

Comprehensive research functionality powered by Azure AI Agents, supporting multiple languages and multi-level research depth.

**Key Features**: Comprehensive deep research, multi-language support, 5 research depth levels, interactive clarification mode, automatic agent creation

**Detailed**: Please refer to [Deep Research Agent README](./deep-research-agent/README.md)

**Step-by-Step Doc:** See [Conduct in-depth research on any topic using Azure OpenAI DeepResearch](https://heyjiqing.notion.site/Conduct-in-depth-research-with-Azure-OpenAI-DeepResearch-23ede7b6e4e880f8b8e4fd9f8e04026a)

### Azure AI Search

Provides multi-mode retrieval over Azure AI Search, covering keyword, semantic, vector, and hybrid queries.

**Key Features**:
- Simple BM25 keyword search with filtering and field projection
- Semantic reranking (with optional captions/answers) using configured semantic profiles
- Vector similarity powered by built-in vectorizers (no manual embedding management)
- Hybrid retrieval that fuses lexical and vector results, plus semantic hybrid mode
- Consistent response shaping (paging, select, filter) across all tool endpoints
- Tools pick up `AZURE_SEARCH_ENDPOINT` and `AZURE_SEARCH_QUERY_KEY` from the runtime environment, so you only need to pass endpoint or api_key when you want to override those defaults for a specific call. The `_resolve_endpoint` / `_resolve_key` helpers enforce that fallback chain.

**Detailed**: Please refer to [Azure AI Search README](./ai-search/README.md)

**Step-by-Step Doc:** See [MCP Server for Azure AI Search](https://heyjiqing.notion.site/MCP-Server-for-Azure-AI-Search-294de7b6e4e8805faccad1f60cc255e2?pvs=74)
