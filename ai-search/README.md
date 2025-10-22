# Azure AI Search MCP Server

A Model Context Protocol (MCP) server that exposes Azure AI Search capabilities across multiple retrieval modes (keyword, semantic, vector, and hybrid).

## Features
- Execute keyword searches using simple syntax.
- Run semantic queries with optional captions and answers.
- Perform pure vector similarity search.
- Combine keyword and vector retrieval (hybrid search).
- Apply semantic reranking on hybrid results for richer answers.
- Support integrated vectorization when your index has an attached vectorizer (no manual embeddings required).

## Quick Start

### Local Development

**1/ Clone Repo**
```bash
git clone https://github.com/HeyJiqingCode/mcp.git
```

**2/ Install dependencies**:
```bash
cd mcp/ai-search/
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**3/ Create a `.env` file**
```bash
# Azure AI Search Endpoint and Query Key
AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net
AZURE_SEARCH_QUERY_KEY=your-query-key

# Timeout (Optional)
AZURE_SEARCH_TIMEOUT=120
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
      "url": "http://127.0.0.1:8000/mcp",
      "headers": {
         "Content-Type": "application/json",
         "Authorization": "Bearer your_token"
      }
    }
  }
}
```

### Docker

**1/ Clone Repo**
```bash
git clone https://github.com/HeyJiqingCode/mcp.git
```

**2/ Build Docker Image**
```bash
cd mcp/ai-search/
docker build -t azure-ai-search-mcp:1.0.0 -f Dockerfile .
```

**3/ Run the container**:
```bash
docker run -itd -p 8000:8000 --name AIFoundryAgent \
  -e AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net \
  -e AZURE_SEARCH_QUERY_KEY=your-query-key \
  azure-ai-search-mcp:1.0.0
```

**4/ Add MCP Server for HTTP transport**
```json
{
  "mcpServers": {
    "AIFoundryAgent": {
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

## Available Tools

Each tool accepts an optional `api_key` and `endpoint` so you can override defaults at invocation time. All responses include:
- `results`: list of documents (with `@search.score`, etc.).
- `count`: total number of documents matched (if available).
- `answers`, `captions`, `facets`: when returned by the service.
- `continuation_token`: set if further paging is available.

### `simple_search`

Keyword (BM25) search over an index using simple query syntax, with optional filters and field selection.

**Paremeters:**

index_name, query, top=5, skip=0, search_fields=None, select=None, filter=None, search_mode="any", api_key=None, endpoint=None

**Example Usage:**
```json
{
  "tool": "simple_search",
  "arguments": {
    "index_name": "knowledge-base",
    "query": "How to config Wifi for Windows PC?",
    "top": 3,
    "select": "title,body"
  }
}
```

### `semantic_search`

Semantic reranked search returning optional captions and answers when the index has semantic configuration enabled.

**Paremeters:**

index_name, query, semantic_configuration, top=5, skip=0, captions="extractive", answers=None, select=None, filter=None, api_key=None, endpoint=None

**Example Usage:**

```json
{
  "tool": "semantic_search",
  "arguments": {
    "index_name": "knowledge-base",
    "query": "How to config Wifi for Windows PC?",
    "semantic_configuration": "default",
    "top": 3
  }
}
```

### `vector_search`

Vector-only similarity search using integrated vectorization (text-to-embedding) over specified vector fields.

**Paremeters:**

index_name, vector_fields, vector_text, k=10, exhaustive=False, weight=None, select=None, filter=None, api_key=None, endpoint=None

**Example Usage:**

```json
{
  "tool": "vector_search",
  "arguments": {
    "index_name": "knowledge-base",
    "vector_fields": "text_vector",
    "vector_text": "How to config Wifi for Windows PC?",
    "k": 5,
    "select": "title,summary"
  }
}
```

### `hybrid_search`

Hybrid (keyword + vector) search that fuses BM25 and vector similarity results using Reciprocal Rank Fusion.

**Paremeters:**

index_name, query, vector_fields, vector_text, k=10, top=10, exhaustive=False, weight=None, select=None, filter=None, search_fields=None, api_key=None, endpoint=None

**Example Usage:**

```json
{
  "tool": "hybrid_search",
  "arguments": {
    "index_name": "knowledge-base",
    "query": "How to config Wifi for Windows PC?",
    "vector_fields": "text_vector",
    "vector_text": "How to config Wifi for Windows PC?",
    "k": 20,
    "top": 5,
    "search_fields": "title,body"
  }
}
```

### `semantic_hybrid_search`

Hybrid (keyword + vector) search with semantic reranking, captions, and answers when configured.

**Paremeters:**

index_name, query, vector_fields, semantic_configuration, vector_text, k=50, top=10, exhaustive=False, weight=None, captions="extractive", answers=None, select=None, filter=None, search_fields=None, api_key=None, endpoint=None

**Example Usage:**

```json
{
  "tool": "semantic_hybrid_search",
  "arguments": {
    "index_name": "knowledge-base",
    "query": "How to config Wifi for Windows PC?",
    "vector_fields": "text_vector",
    "semantic_configuration": "default",
    "vector_text": "How to config Wifi for Windows PC?",
    "k": 30,
    "top": 5,
    "query_caption": "extractive",
    "query_answer": "extractive"
  }
}
```

## More Details

See [MCP Server for Azure AI Search](https://heyjiqing.notion.site/MCP-Server-for-Azure-AI-Search-294de7b6e4e8805faccad1f60cc255e2?pvs=74)