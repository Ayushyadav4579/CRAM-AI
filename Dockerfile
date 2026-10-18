FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 MODEL_DIR=/app/model-artifacts/cram-ai GGUF_MODEL_PATH=/app/model-artifacts/cram-ai-smollm-q4_0.gguf MODEL_META_DIR=/app/model-artifacts/cram-ai-smollm USE_GGUF=1 HF_HOME=/tmp/huggingface
WORKDIR /app
COPY requirements-api.txt /app/requirements-api.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple \
 && pip install --no-cache-dir -r /app/requirements-api.txt \
 && pip install --no-cache-dir --only-binary=:all: llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
COPY model-training /app/model-training
COPY model-artifacts/cram-ai /app/model-artifacts/cram-ai
COPY model-artifacts/cram-ai-smollm/training_metadata.json /app/model-artifacts/cram-ai-smollm/training_metadata.json
COPY model-artifacts/cram-ai-smollm-q4_0.gguf /app/model-artifacts/cram-ai-smollm-q4_0.gguf
EXPOSE 8000
CMD ["uvicorn","api:app","--app-dir","model-training","--host","0.0.0.0","--port","8000"]
