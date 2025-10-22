import asyncio
import io
import logging
import os
import sys
from argparse import ArgumentParser
from typing import Any, Dict, List, Optional

from azure.core.credentials import AzureKeyCredential
from azure.search.documents.aio import SearchClient
from azure.search.documents.models import VectorizableTextQuery
from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

_utf8_stderr = None


def configure_utf8_logging() -> None:
    global _utf8_stderr

    if _utf8_stderr is None:
        _utf8_stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    handler = logging.StreamHandler(_utf8_stderr)
    formatter = logging.Formatter(fmt="[%(levelname)-8s] [%(name)s] %(message)s")
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.handlers.clear()
    root_logger.addHandler(handler)


def _comma_split(value: Optional[str]) -> Optional[List[str]]:
    if not value:
        return None
    return [part.strip() for part in value.split(",") if part.strip()]


configure_utf8_logging()
logger = logging.getLogger(__name__)

mcp = FastMCP("Azure AI Search MCP Server")

AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
DEFAULT_QUERY_KEY = os.getenv("AZURE_SEARCH_QUERY_KEY")
HTTP_TIMEOUT_SECONDS = int(os.getenv("AZURE_SEARCH_TIMEOUT", "30"))
VECTOR_FIELD_SUFFIXES = ("_vector", "_vectors", "_embedding", "_embeddings")


def _resolve_endpoint(endpoint: Optional[str] = None) -> str:
    resolved = endpoint or AZURE_SEARCH_ENDPOINT
    if not resolved:
        raise RuntimeError(
            "Azure Search endpoint is not configured. Set AZURE_SEARCH_ENDPOINT or pass endpoint explicitly."
        )
    return resolved.rstrip("/")


def _resolve_key(explicit_key: Optional[str]) -> str:
    if explicit_key:
        return explicit_key
    if DEFAULT_QUERY_KEY:
        return DEFAULT_QUERY_KEY
    raise RuntimeError("Azure Search API key is not configured. Provide api_key or set AZURE_SEARCH_QUERY_KEY.")


async def _maybe_await(result: Any) -> Any:
    if asyncio.iscoroutine(result):
        return await result
    return result


def _normalize_document(document: Dict[str, Any]) -> Dict[str, Any]:
    def _default(obj: Any) -> Any:
        if hasattr(obj, "isoformat"):
            try:
                return obj.isoformat()
            except Exception:  # pragma: no cover - fallback path
                return str(obj)
        if hasattr(obj, "as_dict"):
            try:
                return obj.as_dict()
            except Exception:  # pragma: no cover - fallback path
                return str(obj)
        if hasattr(obj, "__dict__") and obj.__dict__:
            try:
                return {key: _default(value) for key, value in obj.__dict__.items() if not key.startswith("_")}
            except Exception:  # pragma: no cover
                return str(obj)
        return obj

    serialized: Dict[str, Any] = {}
    for key, value in document.items():
        if isinstance(value, list):
            serialized[key] = [_default(item) for item in value]
        else:
            serialized[key] = _default(value)
    return serialized


def _strip_vector_fields_from_results(results: List[Dict[str, Any]]) -> None:
    def _is_vector_field(field_name: str) -> bool:
        lower_name = field_name.lower()
        return any(lower_name.endswith(suffix) for suffix in VECTOR_FIELD_SUFFIXES)

    for document in results:
        vector_keys = [key for key in document.keys() if isinstance(key, str) and _is_vector_field(key)]
        for key in vector_keys:
            document.pop(key, None)


async def _collect_results(result_iterator: Any) -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []
    async for item in result_iterator:  # each item is SearchResult (Mapping)
        items.append(_normalize_document(dict(item)))

    count = None
    answers = None
    facets = None
    captions = None

    for attr, target in (("get_count", "count"), ("get_answers", "answers"), ("get_facets", "facets"), ("get_captions", "captions")):
        if hasattr(result_iterator, attr):
            try:
                raw = await _maybe_await(getattr(result_iterator, attr)())
            except Exception:  # pragma: no cover - defensive
                continue
            if not raw:
                continue
            if target == "count":
                count = raw
            elif target == "answers":
                answers = [
                    {
                        "key": getattr(answer, "key", None),
                        "text": getattr(answer, "text", None),
                        "highlights": getattr(answer, "highlights", None),
                        "score": getattr(answer, "score", None),
                    }
                    for answer in raw
                ]
            elif target == "facets":
                facets = raw
            elif target == "captions":
                captions = [
                    {
                        "text": getattr(caption, "text", None),
                        "highlights": getattr(caption, "highlights", None),
                    }
                    for caption in raw
                ]

    continuation_token = None
    if hasattr(result_iterator, "get_continuation_token"):
        try:
            continuation_token = result_iterator.get_continuation_token()
        except Exception:  # pragma: no cover - defensive
            continuation_token = None

    return {
        "count": count,
        "results": items,
        "answers": answers,
        "facets": facets,
        "captions": captions,
        "continuation_token": continuation_token,
    }


async def _create_search_client(
    *,
    endpoint: str,
    index_name: str,
    credential: AzureKeyCredential,
) -> SearchClient:
    client = SearchClient(
        endpoint=endpoint,
        index_name=index_name,
        credential=credential,
    )
    return client


async def _execute_search(
    *,
    endpoint: str,
    key: str,
    index_name: str,
    search_text: Optional[str],
    search_kwargs: Dict[str, Any],
) -> Dict[str, Any]:
    credential = AzureKeyCredential(key)
    client = await _create_search_client(endpoint=endpoint, index_name=index_name, credential=credential)
    async with client:
        result_pager = await client.search(
            search_text=search_text,
            **search_kwargs,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        payload = await _collect_results(result_pager)
    return payload


def _build_vector_query(
    *,
    vector_text: str,
    vector_fields: Optional[str],
    k: int,
    exhaustive: bool,
    weight: Optional[float] = None,
) -> List[VectorizableTextQuery]:
    if vector_fields is None:
        raise ValueError("vector_fields must be provided for vector-enabled search.")
    vector_query = VectorizableTextQuery(
        text=vector_text,
        fields=vector_fields,
        k_nearest_neighbors=k,
        exhaustive=exhaustive,
    )
    if weight is not None:
        vector_query.weight = weight
    return [vector_query]


@mcp.tool(
    name="simple_search",
    description="Keyword (BM25) search over an index using simple query syntax, with optional filters and field selection.",
)
async def simple_search(
    index_name: str,
    query: str,
    top: int = 5,
    skip: int = 0,
    search_fields: Optional[str] = None,
    select: Optional[str] = None,
    filter: Optional[str] = None,
    search_mode: str = "any",
    include_vectors: bool = False,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Dict[str, Any]:
    """Run a standard keyword search against Azure AI Search.

    Parameters
    ----------
    index_name: str
        Target index name.
    query: str
        Simple query syntax string (terms, phrases, Boolean operators).
    top: int, optional
        Maximum number of results to return (default 5).
    skip: int, optional
        Number of results to skip for paging.
    search_fields: Optional[str]
        Comma-separated searchable fields to scope the query.
    select: Optional[str]
        Comma-separated retrievable fields in the response.
    filter: Optional[str]
        OData filter expression applied before keyword search.
    search_mode: str, optional
        "any" (default) or "all" to control precision/recall.
    include_vectors: bool, optional
        When True, vector-valued fields (e.g., *_vector) are retained in the payload.
        Defaults to False to avoid returning large embedding arrays.
    api_key / endpoint: Optional[str]
        Override default query key or endpoint for this call.

    Returns
    -------
    dict
        Contains `results`, `count`, optional `facets`, and `continuation_token`.
    """
    resolved_endpoint = _resolve_endpoint(endpoint)
    key = _resolve_key(api_key)
    search_kwargs: Dict[str, Any] = {
        "top": top,
        "skip": skip,
        "include_total_count": True,
        "search_mode": search_mode,
    }
    if filter:
        search_kwargs["filter"] = filter
    fields = _comma_split(search_fields)
    if fields:
        search_kwargs["search_fields"] = fields
    selected = _comma_split(select)
    if selected:
        search_kwargs["select"] = selected

    result = await _execute_search(
        endpoint=resolved_endpoint,
        key=key,
        index_name=index_name,
        search_text=query,
        search_kwargs=search_kwargs,
    )
    if not include_vectors and "results" in result:
        _strip_vector_fields_from_results(result["results"])
    return result


@mcp.tool(
    name="semantic_search",
    description="Semantic reranked search returning optional captions and answers when the index has semantic configuration enabled.",
)
async def semantic_search(
    index_name: str,
    query: str,
    semantic_configuration: str,
    top: int = 5,
    skip: int = 0,
    select: Optional[str] = None,
    filter: Optional[str] = None,
    include_vectors: bool = False,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    query_caption: Optional[str] = "extractive",
    query_answer: Optional[str] = None,
    query_answer_count: Optional[int] = None,
    query_answer_threshold: Optional[float] = None,
) -> Dict[str, Any]:
    """Execute semantic ranking against a configured index.

    Parameters
    ----------
    index_name: str
        Target index name.
    query: str
        Natural-language question or prompt for semantic ranking.
    semantic_configuration: str
        Name of the semantic configuration defined on the index.
    top / skip: int, optional
        Pagination controls (top defaults to 5).
    select / filter: Optional[str]
        Shape the fields returned and pre-filter documents.
    include_vectors: bool, optional
        When True, keep vector-valued fields (e.g., *_vector) in the response payload.
        Defaults to False to reduce payload size.
    api_key / endpoint: Optional[str]
        Override default connection information.
    query_caption / query_answer: Optional[str]
        Semantic caption and answer modes (`"extractive"`, `"summary"`, etc.).
    query_answer_count / query_answer_threshold: Optional
        Controls for the number of answers and confidence threshold.

    Returns
    -------
    dict
        Includes `results`, `count`, optional `answers`, `captions`, and continuation metadata.
    """
    resolved_endpoint = _resolve_endpoint(endpoint)
    key = _resolve_key(api_key)

    search_kwargs: Dict[str, Any] = {
        "query_type": "semantic",
        "semantic_configuration_name": semantic_configuration,
        "semantic_query": query,
        "top": top,
        "skip": skip,
        "include_total_count": True,
    }
    if select:
        search_kwargs["select"] = _comma_split(select)
    if filter:
        search_kwargs["filter"] = filter
    if query_caption:
        search_kwargs["query_caption"] = query_caption
    if query_answer:
        search_kwargs["query_answer"] = query_answer
        if query_answer_count is not None:
            search_kwargs["query_answer_count"] = query_answer_count
        if query_answer_threshold is not None:
            search_kwargs["query_answer_threshold"] = query_answer_threshold

    result = await _execute_search(
        endpoint=resolved_endpoint,
        key=key,
        index_name=index_name,
        search_text=query,
        search_kwargs=search_kwargs,
    )
    if not include_vectors and "results" in result:
        _strip_vector_fields_from_results(result["results"])
    return result


@mcp.tool(
    name="vector_search",
    description="Vector-only similarity search using integrated vectorization (text-to-embedding) over specified vector fields.",
)
async def vector_search(
    index_name: str,
    vector_fields: str,
    vector_text: str,
    k: int = 10,
    exhaustive: bool = False,
    weight: Optional[float] = None,
    select: Optional[str] = None,
    filter: Optional[str] = None,
    include_vectors: bool = False,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Dict[str, Any]:
    """Perform pure vector similarity search.

    Parameters
    ----------
    index_name: str
        Target index name.
    vector_fields: str
        Comma-separated vector field names participating in search.
    vector_text: str
        Raw query text to be vectorized using the index's configured vectorizer.
    k: int, optional
        Number of nearest neighbors to retrieve (default 10).
    exhaustive: bool, optional
        Use exhaustive KNN instead of ANN when True.
    weight: Optional[float]
        Weight assigned to the vector query (relevant when mixing multiple vectors).
    select / filter: Optional[str]
        Restrict fields returned or apply filters before vector scoring.
    include_vectors: bool, optional
        When True, keep vector-valued fields (e.g., *_vector) in the response payload.
        Defaults to False to reduce payload size.
    api_key / endpoint: Optional[str]
        Override default connection information.

    Returns
    -------
    dict
        Includes `results`, `count`, and `continuation_token`.
    """
    resolved_endpoint = _resolve_endpoint(endpoint)
    key = _resolve_key(api_key)

    vector_queries = _build_vector_query(
        vector_text=vector_text,
        vector_fields=vector_fields,
        k=k,
        exhaustive=exhaustive,
        weight=weight,
    )

    search_kwargs: Dict[str, Any] = {
        "vector_queries": vector_queries,
        "top": k,
        "include_total_count": True,
    }
    if select:
        search_kwargs["select"] = _comma_split(select)
    if filter:
        search_kwargs["filter"] = filter

    result = await _execute_search(
        endpoint=resolved_endpoint,
        key=key,
        index_name=index_name,
        search_text=None,
        search_kwargs=search_kwargs,
    )
    if not include_vectors and "results" in result:
        _strip_vector_fields_from_results(result["results"])
    return result


@mcp.tool(
    name="hybrid_search",
    description="Hybrid (keyword + vector) search that fuses BM25 and vector similarity results using Reciprocal Rank Fusion.",
)
async def hybrid_search(
    index_name: str,
    query: str,
    vector_fields: str,
    vector_text: str,
    k: int = 10,
    top: int = 10,
    exhaustive: bool = False,
    weight: Optional[float] = None,
    select: Optional[str] = None,
    filter: Optional[str] = None,
    search_fields: Optional[str] = None,
    include_vectors: bool = False,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Dict[str, Any]:
    """Combine lexical and vector retrieval in a single request.

    Parameters
    ----------
    index_name: str
        Target index name.
    query: str
        Keyword query (simple syntax) for the lexical component.
    vector_fields: str
        Comma-separated vector fields used for similarity search.
    vector_text: str
        Raw query text to be vectorized.
    k / top: int, optional
        Vector candidate count (k) and final result count (top).
    exhaustive / weight: optional
        Control vector search exhaustive mode and weighting.
    select / filter / search_fields: Optional[str]
        Customize returned fields, filters, or lexical scope.
    include_vectors: bool, optional
        When True, keep vector-valued fields (e.g., *_vector) in the response payload.
        Defaults to False to reduce payload size.
    api_key / endpoint: Optional[str]
        Override default connection information.

    Returns
    -------
    dict
        Contains merged `results`, `count`, and continuation metadata.
    """
    resolved_endpoint = _resolve_endpoint(endpoint)
    key = _resolve_key(api_key)

    vector_queries = _build_vector_query(
        vector_text=vector_text,
        vector_fields=vector_fields,
        k=k,
        exhaustive=exhaustive,
        weight=weight,
    )

    search_kwargs: Dict[str, Any] = {
        "vector_queries": vector_queries,
        "top": top,
        "include_total_count": True,
    }
    if select:
        search_kwargs["select"] = _comma_split(select)
    if filter:
        search_kwargs["filter"] = filter
    if search_fields:
        search_kwargs["search_fields"] = _comma_split(search_fields)

    result = await _execute_search(
        endpoint=resolved_endpoint,
        key=key,
        index_name=index_name,
        search_text=query,
        search_kwargs=search_kwargs,
    )
    if not include_vectors and "results" in result:
        _strip_vector_fields_from_results(result["results"])
    return result


@mcp.tool(
    name="semantic_hybrid_search",
    description="Hybrid (keyword + vector) search with semantic reranking, captions, and answers when configured.",
)
async def semantic_hybrid_search(
    index_name: str,
    query: str,
    vector_fields: str,
    semantic_configuration: str,
    vector_text: str,
    k: int = 50,
    top: int = 10,
    exhaustive: bool = False,
    weight: Optional[float] = None,
    select: Optional[str] = None,
    filter: Optional[str] = None,
    search_fields: Optional[str] = None,
    query_caption: Optional[str] = "extractive",
    query_answer: Optional[str] = None,
    query_answer_count: Optional[int] = None,
    query_answer_threshold: Optional[float] = None,
    include_vectors: bool = False,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Dict[str, Any]:
    """Run hybrid retrieval with semantic reranking.

    Parameters
    ----------
    index_name: str
        Target index name.
    query: str
        Natural-language or keyword query for lexical search.
    vector_fields: str
        Comma-separated vector field names.
    semantic_configuration: str
        Semantic configuration name defined on the index.
    vector_text: str
        Raw query text used for vectorization.
    k / top: int, optional
        Vector candidate count and final result count (top defaults to 10).
    exhaustive / weight: optional
        Controls for vector recall and weighting.
    query_caption / query_answer: Optional[str]
        Semantic caption and answer modes (`"extractive"`, `"summary"`, etc.).
    query_answer_count / query_answer_threshold: Optional
        Controls for the number of answers and confidence threshold.
    select / filter / search_fields: Optional[str]
        Additional shaping of results and filters.
    include_vectors: bool, optional
        When True, keep vector-valued fields (e.g., *_vector) in the response payload.
        Defaults to False to reduce payload size.
    api_key / endpoint: Optional[str]
        Override default connection information.

    Returns
    -------
    dict
        Includes `results`, `count`, optional `answers`, `captions`, and continuation metadata.
    """
    resolved_endpoint = _resolve_endpoint(endpoint)
    key = _resolve_key(api_key)

    vector_queries = _build_vector_query(
        vector_text=vector_text,
        vector_fields=vector_fields,
        k=k,
        exhaustive=exhaustive,
        weight=weight,
    )

    search_kwargs: Dict[str, Any] = {
        "vector_queries": vector_queries,
        "query_type": "semantic",
        "semantic_configuration_name": semantic_configuration,
        "top": top,
        "include_total_count": True,
    }
    if query_caption:
        search_kwargs["query_caption"] = query_caption
    if query_answer:
        search_kwargs["query_answer"] = query_answer
        if query_answer_count is not None:
            search_kwargs["query_answer_count"] = query_answer_count
        if query_answer_threshold is not None:
            search_kwargs["query_answer_threshold"] = query_answer_threshold
    if filter:
        search_kwargs["filter"] = filter
    if select:
        search_kwargs["select"] = _comma_split(select)
    if search_fields:
        search_kwargs["search_fields"] = _comma_split(search_fields)

    result = await _execute_search(
        endpoint=resolved_endpoint,
        key=key,
        index_name=index_name,
        search_text=query,
        search_kwargs=search_kwargs,
    )
    if not include_vectors and "results" in result:
        _strip_vector_fields_from_results(result["results"])
    return result


def main() -> None:
    global AZURE_SEARCH_ENDPOINT
    parser = ArgumentParser(description="Start the Azure AI Search MCP server")
    parser.add_argument(
        "--transport",
        required=False,
        default="stdio",
        choices=("stdio", "sse", "streamable-http"),
        help="Transport protocol (default: stdio)",
    )
    parser.add_argument(
        "--endpoint",
        required=False,
        default=AZURE_SEARCH_ENDPOINT,
        help="Override the Azure AI Search endpoint",
    )
    args = parser.parse_args()

    logger.info("Starting Azure AI Search MCP server with transport=%s", args.transport)
    resolved_endpoint = _resolve_endpoint(args.endpoint)
    if resolved_endpoint != AZURE_SEARCH_ENDPOINT:
        os.environ["AZURE_SEARCH_ENDPOINT"] = resolved_endpoint
        AZURE_SEARCH_ENDPOINT = resolved_endpoint
    logger.info("Azure Search endpoint resolved to %s", resolved_endpoint)

    mcp.run(transport="http", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
