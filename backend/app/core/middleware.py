"""Custom HTTP middleware."""

from fastapi.middleware.gzip import GZipMiddleware


class SelectiveGZipMiddleware(GZipMiddleware):
    """GZip compression that skips streaming / binary endpoints.

    Starlette's ``GZipMiddleware`` buffers and compresses *every* response. That
    would batch the chat endpoint's token-by-token ``StreamingResponse`` (hurting
    the live "逐字流式" feel) and waste CPU re-compressing already-compressed
    audio. We bypass those paths and gzip everything else — mostly JSON API
    payloads, which Render does not compress on its own (unlike Vercel's CDN on
    the frontend).
    """

    def __init__(self, app, *, exclude_prefixes=(), minimum_size=500, compresslevel=6):
        super().__init__(app, minimum_size=minimum_size, compresslevel=compresslevel)
        # str.startswith accepts a tuple of prefixes.
        self._exclude_prefixes = tuple(exclude_prefixes)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path", "").startswith(self._exclude_prefixes):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)
