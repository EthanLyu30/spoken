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

EXPOSE 8000
# Bind $PORT when a host (Render / Railway / Fly…) injects one; default 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
