FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 USE_GGUF=1 GGUF_MODEL_PATH=/app/model-artifacts/cram-ai-smollm-q4_0.gguf MODEL_META_DIR=/app/model-artifacts/cram-ai-smollm MODEL_CONTEXT=1024 MODEL_THREADS=2
WORKDIR /app
COPY requirements-api.txt /app/requirements-api.txt
RUN pip install --no-cache-dir --only-binary=llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu -r /app/requirements-api.txt
COPY model-training /app/model-training
COPY model-artifacts/cram-ai-smollm-q4_0.gguf /app/model-artifacts/cram-ai-smollm-q4_0.gguf
COPY model-artifacts/cram-ai-smollm/training_metadata.json /app/model-artifacts/cram-ai-smollm/training_metadata.json
EXPOSE 8000
CMD ["uvicorn","api:app","--app-dir","model-training","--host","0.0.0.0","--port","8000"]
