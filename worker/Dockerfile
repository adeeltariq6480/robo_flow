# FastAPI + Ultralytics YOLO backend for Robo Flow
FROM python:3.12-slim

# System libs required by Ultralytics / OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WEB_CONCURRENCY=1 \
    MALLOC_ARENA_MAX=2 \
    MODEL_DIR=/data/models \
    HF_HOME=/data/huggingface \
    HF_HUB_CACHE=/data/huggingface/hub \
    TRANSFORMERS_CACHE=/data/huggingface \
    TORCH_HOME=/data/torch \
    HF_HUB_DISABLE_XET=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway/Render inject $PORT; default to 8000 locally.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 600"]
