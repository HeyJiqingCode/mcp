# Deep Research MCP Server

A Model Context Protocol (MCP) server powered by Azure AI Agents for comprehensive research capabilities.

## Features

- 🔍 **Comprehensive Research**: Powered by Azure AI Agents with Deep Research Tool
- 🌐 **Multi-language Support**: Research in multi languages
- 📊 **Flexible Scope**: 5 research depth levels (overview, brief, detailed, focused, comprehensive)
- 💬 **Interactive Mode**: Optional clarifying questions for better research quality
- 🔄 **Conversation Context**: Maintain context across multiple research queries
- 🚀 **Auto-agent Creation**: Automatic agent creation with unique naming

## Quick Start

### Local Development

**1/ Clone Repo**
```bash
git clone https://github.com/HeyJiqingCode/mcp.git
```

**2/ Install dependencies**:
```bash
cd mcp/deep-research-agent/
python -m venv .venv
source .venv/bin/activate
pip install -r src/mcp/requirements.txt
```
**3/ Create a `.env` file**
```bash
# If you have an agent id, please use the following environment variables.
AZURE_TENANT_ID=your_tenant_id_here
AZURE_CLIENT_ID=your_client_id_here
AZURE_CLIENT_SECRET=your_client_secret_here
PROJECT_ENDPOINT=https://your-project-name.eastus.api.azureml.ms
AGENT_ID=your_ai_foundry_agent_id_here

# If you do not have an agent id, please use the following environment variables.
AZURE_TENANT_ID=your_tenant_id_here
AZURE_CLIENT_ID=your_client_id_here
AZURE_CLIENT_SECRET=your_client_secret_here
PROJECT_ENDPOINT=https://your-project-name.eastus.api.azureml.ms
MODEL_DEPLOYMENT_NAME=your_model_deployment_name
DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME=your_deep_research_model_deployment_name
BING_RESOURCE_NAME=your_bing_resource_name
```

**4/ Run the server**:
```bash
python server.py
```

**5/ Add MCP Server**
```json
{
  "mcpServers": {
    "DeepResearch": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:8000/mcp",
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
cd mcp/deep-research-agent/
docker build -t deep-research-mcp:0.0.1 -f Dockerfile .
```

**3/ Run the container**:
```bash
# If you have an agent id, please use the following environment variables.
docker run itd -p 8000:8000 --name DeepResearch \
  -e AZURE_TENANT_ID=your_tenant_id \
  -e AZURE_CLIENT_ID=your_client_id \
  -e AZURE_CLIENT_SECRET=your_secret \
  -e PROJECT_ENDPOINT=your_endpoint \
  -e AGENT_ID=your_ai_foundry_agent_id \
  deep-research-mcp:0.0.1

# If you do not have an agent id, please use the following environment variables.
docker run -itd -p 8000:8000 --name DeepResearch \
  -e AZURE_TENANT_ID=your_tenant_id \
  -e AZURE_CLIENT_ID=your_client_id \
  -e AZURE_CLIENT_SECRET=your_secret \
  -e PROJECT_ENDPOINT=your_endpoint \
  -e MODEL_DEPLOYMENT_NAME=your_model \
  -e DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME=your_deep_model \
  -e BING_RESOURCE_NAME=your_bing_resource \
  deep-research-mcp:0.0.1
```
**4/ Add MCP Server**
```json
{
  "mcpServers": {
    "DeepResearch": {
      "type": "streamableHttp",
      "url": "http://your_ip_address:8000/mcp",
      "headers": {
         "Content-Type": "application/json",
         "Authorization": "Bearer your_token"
      }
    }
  }
}
```

## API Usage

**Required Parameters:**
- `topic` (string): The research topic
- `conversation_id` (string): Unique conversation identifier

**Optional Parameters:**
- `language` (string, default: "zh"): Language code (en, zh, es, fr, de, ja, ko)
- `research_scope` (string, default: "overview"): Research depth level
- `interactive` (boolean, default: true): Enable clarifying questions
- `timeout_seconds` (integer, default: 1800): Maximum research time

**Research Scopes**

| Scope | Description |
|-------|-------------|
| `overview` | Concise summary with background and main context |
| `brief` | Brief analysis with examples and data |
| `detailed` | In-depth analysis of all relevant factors |
| `focused` | Deep dive into specific clarified aspects |
| `comprehensive` | Exhaustive report covering all perspectives |

**Example:**
```json
{
  "topic": "2025年人工智能发展趋势",
  "conversation_id": "research_20240613_102327_1745",
  "language": "zh",
  "research_scope": "detailed",
  "interactive": true
}
```

## More Details

See [Conduct in-depth research on any topic using Azure OpenAI DeepResearch](https://heyjiqing.notion.site/Conduct-in-depth-research-with-Azure-OpenAI-DeepResearch-23ede7b6e4e880f8b8e4fd9f8e04026a)