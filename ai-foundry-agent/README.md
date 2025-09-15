# Azure AI Foundry MCP Server

A Model Context Protocol (MCP) server that provides seamless access to agents built by Azure AI Fondry for intelligent task execution and automation.

## Features

- **Agent Management**: List and discover all available agents  in your Azure AI Foundry project
- **Agent Communication**: Connect to and interact with any agent
- **Agent Discovery**: View agent descriptions and capabilities to choose the right agent
- **Conversation Context**: Maintain conversation threads with agents for complex interactions
- **Response Tracking**: Get detailed response data including citations and execution metadata
- **Simple Integration**: Easy-to-use MCP tools for seamless AI agent workflows

## Quick Start

### Local Development

**1/ Clone Repo**
```bash
git clone https://github.com/HeyJiqingCode/mcp.git
```

**2/ Install dependencies**:
```bash
cd mcp/ai-foundry-agent/
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
    "AIFoundryAgent": {
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
cd mcp/ai-foundry-agent/
docker build -t azure-ai-foundry-agent-mcp:1.0.0 -f Dockerfile .
```

**3/ Run the container**:
```bash
docker run -itd -p 8000:8000 --name AIFoundryAgent \
  -e AZURE_AI_FOUNDRY_PROJECT_ENDPOINT=your_ai_foundry_project_endpoint \
  -e AZURE_TENANT_ID=your_tenant_id \
  -e AZURE_CLIENT_ID=your_client_id \
  -e AZURE_CLIENT_SECRET=your_secret \
  azure-ai-foundry-agent-mcp:1.0.0
```

**4/ Add MCP Server for HTTP transport**
```json
{
  "mcpServers": {
    "AIFoundryAgent": {
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

### `list_agents`
Lists all available agents in your project with their descriptions and capabilities.

**Returns:**
- Agent names, IDs, and descriptions
- Helps you choose the appropriate agent for your task

**Example Usage:**
```bash
# The tool will return something like:
## Available Azure AI Agents

- **BingSearchAgent**: `asst_xxxxx`
  - Description: Agent specialized in web search and real-time information retrieval
  
- **DeepResearchAgent**: `asst_xxxxx`  
  - Description: Agent for comprehensive research and analysis tasks
```

### `connect_agent`
Connects to a specific agent and executes a query.

**Parameters:**
- `agent_id` (string): The unique identifier of the agent (from list_agents)
- `query` (string): Your question or task for the agent

**Returns:**
- `success`: Whether the query was successful
- `result`: The agent's response to your query  
- `thread_id`: Conversation thread ID for tracking
- `run_id`: Execution run ID for evaluation
- `citations`: Any sources referenced in the response

**Example Usage:**
```json
{
  "agent_id": "asst_xxxxx",
  "query": "What are the latest developments in AI research?"
}
```

## Transport Options

The server supports three transport protocols:
- `stdio` (default): Standard input/output for local development
- `sse`: Server-sent events for web-based clients  
- `streamable-http`: HTTP streaming for containerized deployments

All transports run on port 8000 by default.

## More Details

See [MCP Server for Azure AI Foundry Agent](https://heyjiqing.notion.site/MCP-Server-for-Azure-AI-Foundry-Agent-256de7b6e4e880238e13ce0c359a0bc7)