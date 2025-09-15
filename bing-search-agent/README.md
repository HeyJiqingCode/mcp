# Bing Search MCP Server

A Model Context Protocol (MCP) server that provides seamless access to Bing Search functionality through Azure AI Foundry Agent integration.

## Features

- **Bing Search Integration**: Perform web searches using Bing Search through Azure AI Foundry Agent
- **Intelligent Results**: Get comprehensive search results with AI-powered analysis and summarization
- **Citation Support**: Automatic source attribution and URL references
- **Response Tracking**: Detailed response metadata including thread and run IDs
- **Simple Integration**: Easy-to-use MCP tool for seamless search workflows

## Quick Start

### Local Development

**1/ Clone Repo**
```bash
git clone https://github.com/HeyJiqingCode/mcp.git
```

**2/ Install dependencies**:
```bash
cd bing-search-agent/
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**3/ Create a `.env` file**
```bash
# Azure authentication
AZURE_TENANT_ID=your_azure_tenant_id
AZURE_CLIENT_ID=your_client_id
AZURE_CLIENT_SECRET=your_client_secrets

# Azure AI Foundry
AZURE_AI_FOUNDRY_PROJECT_ENDPOINT=your_ai_foundry_project_endpoint

# Azure AI Foundry Agent ID (your specific agent with Bing Search enabled)
AZURE_AI_FOUNDRY_AGENT_ID=your_bing_search_agent_id
```

**4/ Run the server**:
```bash
# For stdio transport (default)
python src/mcp/server.py

# For SSE transport
python src/mcp/server.py --transport sse

# For streamable-http transport  
python src/mcp/server.py --transport streamable-http
```

**5/ Add MCP Server to your client**
```json
{
  "mcpServers": {
    "BingSearch": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:8000/mcp/",
      "headers": {
         "Content-Type": "application/json",
         "Authorization": "Bearer your_token"
      }
    }
  }
}
```

### Docker Deployment

**1/ Clone Repo**
```bash
git clone https://github.com/HeyJiqingCode/mcp.git
```

**2/ Build Docker Image**
```bash
cd bing-search-agent/
docker build -t bing-search-mcp:1.0.0 -f Dockerfile .
```

**3/ Run the container**:
```bash
docker run -itd -p 8000:8000 --name BingSearch \
  -e AZURE_AI_FOUNDRY_PROJECT_ENDPOINT=your_ai_foundry_project_endpoint \
  -e AZURE_AI_FOUNDRY_AGENT_ID=your_bing_search_agent_id \
  -e AZURE_TENANT_ID=your_tenant_id \
  -e AZURE_CLIENT_ID=your_client_id \
  -e AZURE_CLIENT_SECRET=your_secret \
  bing-search-mcp:1.0.0
```

**4/ Add MCP Server for HTTP transport**
```json
{
  "mcpServers": {
    "BingSearch": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:8000/mcp/",
      "headers": {
         "Content-Type": "application/json",
         "Authorization": "Bearer your_token"
      }
    }
  }
}
```

## Available Tools

### `bing_search`
Performs web searches using Bing Search through your pre-configured Azure AI Foundry Agent.

**Parameters:**
- `query` (string): Your search query or question

**Returns:**
- `success`: Whether the search was successful
- `result`: Search results with AI-powered analysis and summarization
- `thread_id`: Conversation thread ID for tracking
- `run_id`: Execution run ID for evaluation
- `citations`: Sources and URLs referenced in the search results

**Example Usage:**
```json
{
  "query": "latest developments in artificial intelligence 2024"
}
```

**Example Response:**
```json
{
  "success": true,
  "result": "Based on the latest search results, here are the key developments in AI for 2024:\n\n1. **Large Language Models**: Continued advancement in GPT-4 and competing models...\n\n## Sources\n- [AI Research Report 2024](https://example.com/ai-report)\n- [Tech News: AI Breakthrough](https://example.com/tech-news)",
  "thread_id": "thread_xxxxx",
  "run_id": "run_xxxxx", 
  "citations": ["[AI Research Report 2024](https://example.com/ai-report)", "[Tech News: AI Breakthrough](https://example.com/tech-news)"]
}
```

## Transport Options

The server supports three transport protocols:
- `stdio` (default): Standard input/output for local development
- `sse`: Server-sent events for web-based clients  
- `streamable-http`: HTTP streaming for containerized deployments

All transports run on port 8000 by default.

## More Details

See [MCP Server for Grounding with Bing Search](https://heyjiqing.notion.site/MCP-Server-for-Grounding-with-Bing-Search-256de7b6e4e8806d8fcaf555b8b8126e)