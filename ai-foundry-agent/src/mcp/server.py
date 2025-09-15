import asyncio
import io
import logging
import os
import sys
from argparse import ArgumentParser
from typing import Dict, Literal, Optional
from azure.ai.projects.aio import AIProjectClient
from azure.ai.agents.models import MessageRole
from azure.identity.aio import ClientSecretCredential
from dotenv import load_dotenv
from fastmcp import FastMCP

# Load environment variables
load_dotenv()

# Store the wrapped stderr stream to avoid multiple wrappers
_utf8_stderr = None

# Configure UTF-8 logging to stderr for MCP protocol compliance.
def configure_utf8_logging():
    global _utf8_stderr
    
    if _utf8_stderr is None:
        _utf8_stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    handler = logging.StreamHandler(_utf8_stderr)
    
    formatter = logging.Formatter(
        fmt='[%(levelname)-8s] [%(name)s] %(message)s',
    )
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.handlers.clear()
    root_logger.addHandler(handler)

configure_utf8_logging()
logger = logging.getLogger(__name__)

# Initialize FastMCP server with detailed information
mcp = FastMCP("Azure AI Foundry Agents MCP Server")

# Global configuration variables
AZURE_AI_FOUNDRY_PROJECT_ENDPOINT = None
AGENT_INITIALIZED = False
AI_CLIENT: Optional[AIProjectClient] = None
AGENT_CACHE = {}
USER_AGENT = "foundry-mcp"

# Initialize the agent client
async def initialize_agent_client():
    global AI_CLIENT

    if not AGENT_INITIALIZED:
        return False

    try:
        credential = ClientSecretCredential(
            tenant_id=os.environ.get("AZURE_TENANT_ID"),
            client_id=os.environ.get("AZURE_CLIENT_ID"),
            client_secret=os.environ.get("AZURE_CLIENT_SECRET")
        )
        AI_CLIENT = AIProjectClient(endpoint=AZURE_AI_FOUNDRY_PROJECT_ENDPOINT, credential=credential, user_agent=USER_AGENT)
        return True
    except Exception as e:
        logger.error(f"Failed to initialize AIProjectClient: {str(e)}")
        return False

# Retrieve agent information
async def get_agent(client: AIProjectClient, agent_id: str) -> Dict:
    global AGENT_CACHE

    if agent_id in AGENT_CACHE:
        return AGENT_CACHE[agent_id]

    try:
        agent = await client.agents.get_agent(agent_id=agent_id)
        
        agent_info = {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "model": agent.model,
            "created_at": str(agent.created_at),
            "tools_count": len(agent.tools) if agent.tools else 0,
            "agent_object": agent
        }
        
        AGENT_CACHE[agent_id] = agent_info
        return agent_info
    except Exception as e:
        logger.error(f"Agent retrieval failed - ID: {agent_id}, Error: {str(e)}")
        raise ValueError(f"Agent not found or inaccessible: {agent_id}")

# Query an Azure AI Foundry Agent
async def query_agent(client: AIProjectClient, agent_id: str, query: str) -> Dict:
    try:
        agent_info = await get_agent(client, agent_id)
        agent = agent_info["agent_object"]

        thread = await client.agents.threads.create()
        thread_id = thread.id

        await client.agents.messages.create(thread_id=thread_id, role=MessageRole.USER, content=query)

        run = await client.agents.runs.create(thread_id=thread_id, agent_id=agent_id)
        run_id = run.id

        while run.status in ["queued", "in_progress", "requires_action"]:
            await asyncio.sleep(1)
            run = await client.agents.runs.get(thread_id=thread_id, run_id=run.id)

        if run.status == "failed":
            error_msg = f"Agent run failed: {run.last_error}"
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "thread_id": thread_id,
                "run_id": run_id,
                "result": f"Error: {error_msg}",
            }

        response_messages = client.agents.messages.list(thread_id=thread_id)
        response_message = None
        async for msg in response_messages:
            if msg.role == MessageRole.AGENT:
                response_message = msg

        result = ""
        citations = []

        if response_message:
            for text_message in response_message.text_messages:
                result += text_message.text.value + "\n"

            for annotation in response_message.url_citation_annotations:
                citation = f"[{annotation.url_citation.title}]({annotation.url_citation.url})"
                if citation not in citations:
                    citations.append(citation)

        if citations:
            result += "\n\n## Sources\n"
            for citation in citations:
                result += f"- {citation}\n"

        return {
            "success": True,
            "thread_id": thread_id,
            "run_id": run_id,
            "result": result.strip(),
            "citations": citations,
        }

    except Exception as e:
        logger.error(f"Agent query failed - ID: {agent_id}, Error: {str(e)}")
        raise

# List all available Azure AI Foundry Agents
@mcp.tool(
    name="list_agents",
    description="""
    List all available Azure AI Foundry Agents in your project. 
    Returns a formatted list of agents with their names, IDs, and descriptions.
    This helps you understand what each agent does before connecting to it.
    """
)
async def list_agents() -> str:
    if not AGENT_INITIALIZED:
        return "Error: Azure AI Foundry Agent service is not initialized. Check environment variables."

    if AI_CLIENT is None:
        await initialize_agent_client()
        if AI_CLIENT is None:
            return "Error: Failed to initialize Azure AI Foundry Agent client."

    try:
        agents = AI_CLIENT.agents.list_agents()
        if not agents:
            return "No agents found in the Azure AI Foundry Agent Service."

        result = "## Available Azure AI Foundry Agents\n\n"
        async for agent in agents:
            description = agent.description if agent.description else "No description available"
            result += f"- **{agent.name}**: `{agent.id}`\n  - Description: {description}\n\n"

        return result
    except Exception as e:
        logger.error(f"Error listing agents: {str(e)}")
        return f"Error listing agents: {str(e)}"

# Connect to a specific Azure AI Foundry Agent
@mcp.tool(
    name="connect_agent",
    description="""
    Connect to a specific Azure AI Foundry Agent and execute a query.

    This tool allows you to interact with any of your Azure AI Foundry Agents by providing
    the agent ID and your question or task. The agent will process your request
    using its configured tools and capabilities.

    Parameters:
    - agent_id: The unique identifier of the agent (get this from list_agents)
    - query: Your question or task for the agent to process

    Returns:
    - success: Whether the query was successful
    - result: The agent's response to your query
    - thread_id: Conversation thread ID for tracking
    - run_id: Execution run ID for evaluation
    - citations: Any sources referenced in the response
    """
)
async def connect_agent(agent_id: str, query: str) -> Dict:
    if not AGENT_INITIALIZED:
        return {"error": "Azure AI Foundry Agent service is not initialized. Check environment variables."}

    if AI_CLIENT is None:
        await initialize_agent_client()
        if AI_CLIENT is None:
            return {"error": "Failed to initialize Azure AI Foundry Agent client."}

    try:
        response = await query_agent(AI_CLIENT, agent_id, query)
        return response
    except Exception as e:
        logger.error(f"Error connecting to agent: {str(e)}")
        return {"error": f"Error connecting to agent: {str(e)}"}

# Main entry point
def main() -> None:
    global AZURE_AI_FOUNDRY_PROJECT_ENDPOINT, AGENT_INITIALIZED
    
    parser = ArgumentParser(description="Start the MCP service with provided or default configuration.")
    parser.add_argument('--transport', required=False, default='stdio',
                        help='Transport protocol (sse | stdio | streamable-http) (default: stdio)')

    args = parser.parse_args()

    specified_transport: Literal["stdio", "sse", "streamable-http"] = args.transport

    logger.info(f"Starting MCP server: Transport = {specified_transport}")

    try:
        AZURE_AI_FOUNDRY_PROJECT_ENDPOINT = os.environ.get("AZURE_AI_FOUNDRY_PROJECT_ENDPOINT")

        AGENT_INITIALIZED = bool(AZURE_AI_FOUNDRY_PROJECT_ENDPOINT)
        if not AGENT_INITIALIZED:
            logger.warning("AZURE_AI_FOUNDRY_PROJECT_ENDPOINT is missing, agent features will not work")

    except Exception as e:
        logger.error(f"Initialization error: {str(e)}")
        AZURE_AI_FOUNDRY_PROJECT_ENDPOINT = None
        AGENT_INITIALIZED = False

    # Run the server
    mcp.run(transport="http", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()