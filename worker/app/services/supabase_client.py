import logging

import httpx
from supabase import Client, ClientOptions, create_client

from app.config import settings

logger = logging.getLogger(__name__)

_client: Client | None = None


def _build_httpx_client() -> httpx.Client:
    """Stable HTTP/1.1 client — avoids httpcore HTTP/2 stream resets on Railway."""
    return httpx.Client(
        http2=False,
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
    )


def get_supabase() -> Client:
    global _client
    if _client is None:
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the worker."
            )
        httpx_client = _build_httpx_client()
        try:
            options = ClientOptions(httpx_client=httpx_client)
            _client = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key,
                options=options,
            )
        except TypeError:
            logger.warning(
                "Supabase ClientOptions httpx_client unsupported — using default client"
            )
            _client = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key,
            )
        logger.info("Supabase client ready (http2=False, pooled connections)")
    return _client
