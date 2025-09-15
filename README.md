# MCP Server Collection

A collection of multiple Model Context Protocol (MCP) servers.

## Project Overview

This project contains three MCP servers, each focused on specific AI functional areas:

- **[Azure AI Foundry Agent](./ai-foundry-agent/)** - Azure AI Foundry agent management and interaction
- **[Bing Search Agent](./bing-search-agent/)** - Intelligent web search and information retrieval
- **[Deep Research Agent](./deep-research-agent/)** - Deep research and comprehensive analysis

## Project Structure

```
mcp/
├── README.md                    # This file
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
└── deep-research-agent/        # Deep Research Agent MCP Server
    ├── README.md
    ├── Dockerfile
    ├── LICENSE
    ├── DifyAgent.yml
    ├── mcp.json
    └── src/
```

## MCP Server Overview

### AI Foundry Agent

Provides seamless access to intelligent agents built with Azure AI Foundry, supporting agent management, communication, and conversation context maintenance.

**Key Features**: Agent management and discovery, agent communication and interaction, conversation context maintenance, response tracking and citation

**Detailed**: Please refer to [Azure AI Foundry Agent README](./ai-foundry-agent/README.md)

---

### Bing Search Agent

Provides intelligent web search functionality through Azure AI Foundry Agent integration, supporting AI analysis and result summarization.

**Key Features**: Bing search integration, AI analysis and summarization, automatic citation and source attribution, detailed response metadata

**Detailed**: Please refer to [Bing Search Agent README](./bing-search-agent/README.md)

---

### Deep Research Agent

Comprehensive research functionality powered by Azure AI Agents, supporting multiple languages and multi-level research depth.

**Key Features**: Comprehensive deep research, multi-language support, 5 research depth levels, interactive clarification mode, automatic agent creation

**Detailed**: Please refer to [Deep Research Agent README](./deep-research-agent/README.md)