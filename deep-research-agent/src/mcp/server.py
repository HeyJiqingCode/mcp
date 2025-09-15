import asyncio
import os
import time
import logging
import datetime
from typing import Dict, Annotated, Optional, Tuple
from pydantic import Field

from fastmcp import FastMCP, Context
from azure.ai.projects.aio import AIProjectClient
from azure.ai.agents.models import MessageRole, ThreadMessage, DeepResearchTool
from azure.identity.aio import ClientSecretCredential
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Reduce uvicorn access log noise for non-essential requests
uvicorn_logger = logging.getLogger("uvicorn.access")
uvicorn_logger.setLevel(logging.WARNING)

# Initialize FastMCP server
mcp = FastMCP("Deep Research Server")

# Simple conversation_id -> thread_id mapping
conversation_threads: Dict[str, str] = {}

# Global agent ID - will be set during startup
AGENT_ID = None

async def create_or_get_agent() -> str:
    """Create a new agent or return existing agent ID"""
    global AGENT_ID
    
    if AGENT_ID:
        return AGENT_ID
    
    # Check if AGENT_ID exists in environment
    if os.getenv("AGENT_ID"):
        AGENT_ID = os.environ["AGENT_ID"]
        logger.info(f"Using existing agent: {AGENT_ID}")
        return AGENT_ID
    
    # Create new agent
    try:
        credential = ClientSecretCredential(
            tenant_id=os.environ["AZURE_TENANT_ID"],
            client_id=os.environ["AZURE_CLIENT_ID"],
            client_secret=os.environ["AZURE_CLIENT_SECRET"]
        )
        
        project_client = AIProjectClient(
            endpoint=os.environ["PROJECT_ENDPOINT"],
            credential=credential,
        )
        
        async with project_client:
            # Get Bing connection
            bing_connection = await project_client.connections.get(name=os.environ["BING_RESOURCE_NAME"])
            
            # Initialize Deep Research tool
            deep_research_tool = DeepResearchTool(
                bing_grounding_connection_id=bing_connection.id,
                deep_research_model=os.environ["DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME"],
            )
            
            agents_client = project_client.agents
            
            # Generate unique agent name with timestamp
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            agent_name = f"DeepResearch-MCP-{timestamp}"
            
            agent = await agents_client.create_agent(
                model=os.environ["MODEL_DEPLOYMENT_NAME"],
                name=agent_name,
                instructions="You are an intelligent research assistant. Always follow the specific instructions provided in each conversation.",
                tools=deep_research_tool.definitions,
            )
            
            AGENT_ID = agent.id
            logger.info(f"Created new agent: {agent_name} (ID: {AGENT_ID})")
            return AGENT_ID
            
    except Exception as e:
        logger.error(f"Failed to create agent: {e}")
        raise

async def get_conversation_thread(conversation_id: str, agents_client) -> str:
    """Get or create thread for conversation_id"""
    if conversation_id not in conversation_threads:
        # Create new thread for new conversation
        thread = await agents_client.threads.create()
        conversation_threads[conversation_id] = thread.id
    
    return conversation_threads[conversation_id]

async def fetch_and_report_new_agent_message(
    *,
    thread_id: str,
    agents_client,
    last_message_id: Optional[str],
    ctx: Context,
) -> Tuple[Optional[str], bool]:
    """Fetch last AGENT message; if new, stream concise update via ctx.info.

    Returns: (new_last_message_id, False) — boolean reserved for future use.
    """
    try:
        response = await agents_client.messages.get_last_message_by_role(
            thread_id=thread_id,
            role=MessageRole.AGENT,
        )
    except Exception as e:
        logger.debug(f"Skip latest-message fetch (transient): {e}")
        return last_message_id, False

    if not response or response.id == last_message_id:
        return last_message_id, False

    # Collate textual content
    agent_text = "\n".join(t.text.value for t in (response.text_messages or []))
    summary = agent_text.strip() if agent_text.strip() else "(no textual content)"

    # Build a compact update message
    lines = ["[Agent update]", summary]
    # Append unique citations if any
    if getattr(response, "url_citation_annotations", None):
        seen = set()
        for ann in response.url_citation_annotations:
            url = ann.url_citation.url
            title = ann.url_citation.title or url
            if url not in seen:
                lines.append(f"Reference: {title} - {url}")
                seen.add(url)

    # Stream update to caller
    await ctx.info("\n".join(lines))
    return response.id, False

async def create_research_summary(message: ThreadMessage) -> str:
    """Create formatted research summary from agent message"""
    if not message:
        return "No content available"
    
    # Extract text content
    content_parts = []
    if message.text_messages:
        content_parts.extend([t.text.value.strip() for t in message.text_messages])
    
    report_content = "\n\n".join(content_parts) if content_parts else "No research content generated"
    
    # Add citations if present
    if message.url_citation_annotations:
        report_content += "\n\n## References\n"
        seen_urls = set()
        for ann in message.url_citation_annotations:
            url = ann.url_citation.url
            title = ann.url_citation.title or url
            if url not in seen_urls:
                report_content += f"- [{title}]({url})\n"
                seen_urls.add(url)
    
    return report_content

@mcp.tool(
    name="deep_research", 
    description="Perform comprehensive research on any topic using Azure AI Agents. REQUIRED: topic, conversation_id. Optional: language, research_scope, interactive"
)
async def deep_research(
    topic: Annotated[str, Field(description="The topic to research")],
    conversation_id: Annotated[str, Field(description="Conversation ID to maintain context across multiple research queries")],
    ctx: Context,
    language: Annotated[str, Field(description="The language to use for the report in ISO 639-1 format, e.g., 'en' for English, 'zh' for Chinese")] = "zh",
    research_scope: Annotated[str, Field(description="Research report detail level: 'overview', 'brief', 'detailed', 'focused', 'comprehensive'")] = "overview",
    interactive: Annotated[bool, Field(description="Whether to ask clarifying questions before starting research")] = True,
    timeout_seconds: Annotated[int, Field(description="Maximum time to wait for completion (1800-3600 seconds)", ge=1800, le=3600)] = 1800
) -> str:
    """Perform deep research with conversation-based context management"""
    
    # Validate required parameters
    if not topic or len(topic.strip()) < 5:
        error_msg = "Error: 'topic' parameter is required and must be at least 5 characters long."
        await ctx.error(error_msg)
        return error_msg
    
    if research_scope not in ["overview", "brief", "detailed", "focused", "comprehensive"]:
        error_msg = "Error: 'research_scope' must be one of: 'overview', 'brief', 'detailed', 'focused', 'comprehensive'"
        await ctx.error(error_msg)
        return error_msg
    
    if not conversation_id or len(conversation_id.strip()) < 3:
        error_msg = "Error: 'conversation_id' parameter is required and must be at least 3 characters long."
        await ctx.error(error_msg)
        return error_msg
    
    language_names = {
        "en": "English",
        "zh": "Chinese",
        "es": "Spanish", 
        "fr": "French",
        "de": "German",
        "ja": "Japanese",
        "ko": "Korean"
    }
    
    if language not in language_names:
        error_msg = f"Error: Unsupported language '{language}'. Supported: {', '.join(language_names.keys())}"
        await ctx.error(error_msg)
        return error_msg
    
    try:
        # Initialize Azure clients with Service Principal
        credential = ClientSecretCredential(
            tenant_id=os.environ["AZURE_TENANT_ID"],
            client_id=os.environ["AZURE_CLIENT_ID"],
            client_secret=os.environ["AZURE_CLIENT_SECRET"]
        )
        
        project_client = AIProjectClient(
            endpoint=os.environ["PROJECT_ENDPOINT"],
            credential=credential,
        )
        
        async with project_client:
            agents_client = project_client.agents
            
            # Get or create conversation thread
            thread_id = await get_conversation_thread(conversation_id, agents_client)
            
            # Get agent and thread objects
            agent_id = await create_or_get_agent()
            thread = await agents_client.threads.get(thread_id)
            
            # Create research instruction based on scope (report detail level)
            scope_instructions = {
                "overview": "provide a concise and well-structured summary of all main points within the user's clarified focus area. Background and main context only, no deep analysis.",
                "brief": "deliver a brief analysis with structured explanations and relevant examples or data, only within the boundaries specified in the clarification step.",
                "detailed": "conduct an in-depth analysis with detailed examination of all relevant factors", 
                "focused": "conduct an in-depth analysis focused exclusively on the clarified aspects. Use comparative evidence, expert commentary, or data as relevant.",
                "comprehensive": "deliver an exhaustive, comprehensive research report covering all relevant aspects, controversies, theories, data, and perspectives—strictly within the boundaries clarified with the user, without extending to unrelated areas."
            }
            
            language_instruction = f"Please respond in {language_names[language]} language"
            scope_instruction = f"But, please make sure to {scope_instructions[research_scope]}"

            # Different message formats based on interactive mode
            if interactive:
                research_message = f"""
Research Guidelines: 
- Your research process consists of the following steps:
    - Receive Topic: When the user submits a research topic or question, carefully review the input.
    - Clarification(Mandatory): Analyze the topic and ask clarifying questions.
    - Initiate Research: Once the topic is sufficiently clarified, begin collecting relevant information.
    - Report Generation: Organize your findings and generate a structured research report according to the requested scope and detail level.
- Now you have the research topic: {topic}.
- Before conducting research:
    - Analyze the topic and ask clarifying questions.
    - Ask maximum 5 essential questions that will significantly improve research quality, the questions should be concise and purposeful.
- Once you have clarity, immediately begin your research. {scope_instruction}
- During collecting information for your report:
    - Always prioritize using connected online resources(such as bing) to obtain the most up-to-date and relevant data.
    - Focus only on materials that directly support the user’s clarified needs, do not pursue tangential topics or try to cover every possible aspect.
    - After gathering external information, quickly evaluate whether the collected information sufficiently covers the core scope—if so, stop further searching and proceed with report generation.
    - Prioritize relevance and recency over exhaustiveness in your search and selection of materials.
- When generating the report, always:
    - Structure your findings using clear sections with headings (e.g., Key Facts, Recommendations, Useful Links).
    - Where possible, provide links to authoritative, up-to-date online sources that support your findings.
    - Present information in a focused, actionable style. Be direct; avoid unnecessary filler or verbose background.
    - Unless the selected research scope requires exhaustive detail, keep the report succinct and practical. For "overview", or "brief" scopes, aim for 2-5 screenfuls or less, and avoid deep technical detail unless explicitly requested.
    - For "detailed", "focused", or "comprehensive" scopes, expand analysis and detail as needed to match the chosen depth, even if that means a longer report or inclusion of necessary technical information. But always aim to finish the complete process within 10 minutes.
    - Always prioritize clarity, readability, and practical value for the user.
- {language_instruction}."""
            else:
                research_message = f"""
Research Guidelines: 
- Your research process consists of the following steps:
    - Receive Topic: When the user submits a research topic or question, carefully review the input.
    - Initiate Research: Collecting relevant information to research the topic.
    - Report Generation: Organize your findings and generate a structured research report according to the requested scope and detail level.
- Once you have the research topic: {topic}, immediately begin your research. {scope_instruction}
- During collecting information for your report:
    - Always prioritize using connected online resources(such as bing) to obtain the most up-to-date and relevant data.
    - Focus only on materials that directly support the user’s clarified needs, do not pursue tangential topics or try to cover every possible aspect.
    - After gathering external information, quickly evaluate whether the collected information sufficiently covers the core scope—if so, stop further searching and proceed with report generation.
    - Prioritize relevance and recency over exhaustiveness in your search and selection of materials.
- When generating the report, always:
    - Structure your findings using clear sections with headings (e.g., Key Facts, Recommendations, Useful Links).
    - Where possible, provide links to authoritative, up-to-date online sources that support your findings.
    - Present information in a focused, actionable style. Be direct; avoid unnecessary filler or verbose background.
    - Unless the selected research scope requires exhaustive detail, keep the report succinct and practical. For "overview", or "brief" scopes, aim for 2-5 screenfuls or less, and avoid deep technical detail unless explicitly requested.
    - For "detailed", "focused", or "comprehensive" scopes, expand analysis and detail as needed to match the chosen depth, even if that means a longer report or inclusion of necessary technical information. But always aim to finish the complete process within 15 minutes.
    - Always prioritize clarity, readability, and practical value for the user.
- {language_instruction}."""
            
            # Create message in thread
            await agents_client.messages.create(
                thread_id=thread.id,
                role="user", 
                content=research_message
            )
            
            await ctx.info("Starting research...")
            logger.info(f"Research started: {topic} (conversation: {conversation_id})")
            
            # Start research run with timeout
            run = await agents_client.runs.create(thread_id=thread.id, agent_id=agent_id)
            
            start_time = time.time()
            last_message_id: Optional[str] = None
            
            # Poll run status with timeout
            while run.status in ("queued", "in_progress"):
                elapsed = time.time() - start_time
                if elapsed > timeout_seconds:
                    await ctx.error(f"Research timed out after {timeout_seconds} seconds")
                    return f"Research request timed out after {timeout_seconds} seconds. Please try a shorter timeout."
                
                # Report any new agent message before next status poll
                try:
                    last_message_id, _ = await fetch_and_report_new_agent_message(
                        thread_id=thread.id,
                        agents_client=agents_client,
                        last_message_id=last_message_id,
                        ctx=ctx,
                    )
                except Exception as e:
                    logger.debug(f"latest-message update skipped: {e}")

                await asyncio.sleep(10)  # slightly tighter cadence for fresher updates
                run = await agents_client.runs.get(thread_id=thread.id, run_id=run.id)
            
            logger.info(f"Research completed with status: {run.status}")
            
            if run.status == "failed":
                error_msg = f"Research failed: {run.last_error}"
                await ctx.error(error_msg)
                return error_msg
            
            # Get final research result
            # Final sweep for any last message produced right at completion
            try:
                last_message_id, _ = await fetch_and_report_new_agent_message(
                    thread_id=thread.id,
                    agents_client=agents_client,
                    last_message_id=last_message_id,
                    ctx=ctx,
                )
            except Exception:
                pass

            final_message = await agents_client.messages.get_last_message_by_role(
                thread_id=thread.id,
                role=MessageRole.AGENT
            )
            
            if final_message:
                result = await create_research_summary(final_message)
                await ctx.info("Research completed successfully!")
                return result
            else:
                return "No research results available"
                
    except Exception as e:
        error_msg = f"Research failed: {str(e)}"
        logger.error(error_msg)
        await ctx.error(error_msg)
        return error_msg

async def main():
    """Start the FastMCP server"""
    logger.info("Starting Deep Research MCP Server with FastMCP...")
    
    # Check required environment variables
    required_env_vars = [
        "PROJECT_ENDPOINT",
        "AZURE_TENANT_ID",
        "AZURE_CLIENT_ID", 
        "AZURE_CLIENT_SECRET",
        "MODEL_DEPLOYMENT_NAME",
        "DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME",
        "BING_RESOURCE_NAME"
    ]
    
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    if missing_vars:
        logger.error(f"Missing required environment variables: {missing_vars}")
        return
    
    # Initialize agent on startup
    try:
        await create_or_get_agent()
        logger.info("Agent initialization completed")
    except Exception as e:
        logger.error(f"Failed to initialize agent: {e}")
        return
    
    # Run FastMCP server
    await mcp.run_async(transport="http", host="0.0.0.0", port=8000)

if __name__ == "__main__":
    asyncio.run(main())
