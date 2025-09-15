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
mcp = FastMCP("Bing Search MCP Server")

# Global configuration variables
AZURE_AI_FOUNDRY_PROJECT_ENDPOINT = None
AZURE_AI_FOUNDRY_AGENT_ID = None
AI_CLIENT: Optional[AIProjectClient] = None
USER_AGENT = "bing-search-mcp"

# Initialize the agent client
async def initialize_agent_client():
    global AI_CLIENT

    if not (AZURE_AI_FOUNDRY_PROJECT_ENDPOINT and AZURE_AI_FOUNDRY_AGENT_ID):
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

# Check if error is the specific BingGroundingRequestParam ast.Name issue
def is_bing_ast_error(error_msg):
    if not error_msg:
        return False
    error_str = str(error_msg)
    return (
        'tool_server_error' in error_str and
        'bing_grounding_server_error' in error_str and
        'BingGroundingRequestParam' in error_str and
        'ast.Name object' in error_str
    )

# Query an Azure AI Foundry Agent
async def query_agent(client: AIProjectClient, agent_id: str, query: str) -> Dict:
    try:
        agent = await client.agents.get_agent(agent_id=agent_id)

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
            
            if is_bing_ast_error(run.last_error):
                logger.info("Detected Bing AST error, retrying until success...")
                max_retries = 5  # Prevent infinite loop
                retry_count = 0
                
                while retry_count < max_retries:
                    retry_count += 1
                    try:
                        logger.info(f"Retry attempt {retry_count}/{max_retries}")
                        retry_thread = await client.agents.threads.create()
                        await client.agents.messages.create(thread_id=retry_thread.id, role=MessageRole.USER, content=query)
                        retry_run = await client.agents.runs.create(thread_id=retry_thread.id, agent_id=agent_id)
                        
                        while retry_run.status in ["queued", "in_progress", "requires_action"]:
                            await asyncio.sleep(1)
                            retry_run = await client.agents.runs.get(thread_id=retry_thread.id, run_id=retry_run.id)
                        
                        if retry_run.status != "failed":
                            logger.info(f"Retry {retry_count} succeeded, using retry results")
                            thread_id = retry_thread.id
                            run_id = retry_run.id
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
                        else:
                            # Check if retry also has the same error
                            if is_bing_ast_error(retry_run.last_error):
                                logger.warning(f"Retry {retry_count} failed with same Bing AST error, continuing...")
                                logger.error(f"Retry {retry_count} detailed error: {retry_run.last_error}")
                                continue
                            else:
                                logger.error(f"Retry {retry_count} failed with different error: {retry_run.last_error}")
                                break
                    except Exception as e:
                        logger.error(f"Retry attempt {retry_count} failed: {e}")
                        continue
                
                logger.error(f"All {max_retries} retry attempts failed")
            
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

# Bing Search tool
@mcp.tool(
    name="bing_search",
    description="""
    Perform a Bing search using Azure AI Foundry Agent with integrated Bing Search capabilities.
    
    This tool connects to a pre-configured Azure AI Foundry Agent that has Bing Search functionality
    enabled. Simply provide your search query and get comprehensive search results with citations.
    
    Parameters:
    - query: Your search query or question to search for on Bing
    
    Returns:
    - success: Whether the search was successful
    - result: The search results and relevant information
    - thread_id: Conversation thread ID for tracking
    - run_id: Execution run ID for evaluation
    - citations: Sources and URLs referenced in the search results
    """
)
async def bing_search(query: str) -> Dict:
    if not (AZURE_AI_FOUNDRY_PROJECT_ENDPOINT and AZURE_AI_FOUNDRY_AGENT_ID):
        return {"error": "Bing Search service is not initialized. Check AZURE_AI_FOUNDRY_PROJECT_ENDPOINT and AZURE_AI_FOUNDRY_AGENT_ID environment variables."}

    if AI_CLIENT is None:
        await initialize_agent_client()
        if AI_CLIENT is None:
            return {"error": "Failed to initialize Bing Search client."}

    try:
        response = await query_agent(AI_CLIENT, AZURE_AI_FOUNDRY_AGENT_ID, query)
        return response
    except Exception as e:
        logger.error(f"Error performing Bing search: {str(e)}")
        return {"error": f"Error performing Bing search: {str(e)}"}

# Main entry point
def main() -> None:
    global AZURE_AI_FOUNDRY_PROJECT_ENDPOINT, AZURE_AI_FOUNDRY_AGENT_ID
    
    parser = ArgumentParser(description="Start the Bing Search MCP server with provided or default configuration.")
    parser.add_argument('--transport', required=False, default='stdio',
                        help='Transport protocol (sse | stdio | streamable-http) (default: stdio)')

    args = parser.parse_args()

    specified_transport: Literal["stdio", "sse", "streamable-http"] = args.transport

    logger.info(f"Starting Bing Search MCP server: Transport = {specified_transport}")

    try:
        AZURE_AI_FOUNDRY_PROJECT_ENDPOINT = os.environ.get("AZURE_AI_FOUNDRY_PROJECT_ENDPOINT")
        AZURE_AI_FOUNDRY_AGENT_ID = os.environ.get("AZURE_AI_FOUNDRY_AGENT_ID")

        if not AZURE_AI_FOUNDRY_PROJECT_ENDPOINT:
            logger.warning("AZURE_AI_FOUNDRY_PROJECT_ENDPOINT is missing")
        if not AZURE_AI_FOUNDRY_AGENT_ID:
            logger.warning("AZURE_AI_FOUNDRY_AGENT_ID is missing")
        
        if not (AZURE_AI_FOUNDRY_PROJECT_ENDPOINT and AZURE_AI_FOUNDRY_AGENT_ID):
            logger.warning("Bing Search features will not work without both environment variables")

    except Exception as e:
        logger.error(f"Initialization error: {str(e)}")
        AZURE_AI_FOUNDRY_PROJECT_ENDPOINT = None
        AZURE_AI_FOUNDRY_AGENT_ID = None

    # Run the server
    mcp.run(transport="http", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()