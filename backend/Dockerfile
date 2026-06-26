# Spoken backend — FastAPI on Python 3.11
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code (tests / .env / .venv are excluded via .dockerignore).
COPY app ./app

# Run as an unprivileged user. Pre-create /data (the docker-compose named-volume
# mount point for SQLite) and own /app (default SQLite path) so a non-root
# process can write the database. A fresh named volume inherits this ownership.
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

# Liveness check via the health endpoint (slim image has no curl — use stdlib).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/health').status==200 else 1)"

# Bind $PORT when a host (Render / Railway / Fly…) injects one; default 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
