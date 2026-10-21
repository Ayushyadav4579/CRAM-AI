FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 USE_GGUF=1 GGUF_MODEL_PATH=/app/model-artifacts/cram-ai-smollm-q4_0.gguf MODEL_CONTEXT=1024 MODEL_THREADS=2 MODEL_BATCH=16 MODEL_UBATCH=16 CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=OFF -DGGML_FMA=OFF -DGGML_AVX512=OFF"
WORKDIR /app
COPY requirements-gguf.txt /app/requirements-gguf.txt
# The CPU wheel index may not publish a wheel for every Python/platform combination.
# Install the toolchain so pip can safely build llama-cpp-python when it must fall back to source.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake ninja-build git \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --prefer-binary --index-url https://abetlen.github.io/llama-cpp-python/whl/cpu --extra-index-url https://pypi.org/simple -r /app/requirements-gguf.txt
COPY model-training /app/model-training
COPY model-artifacts/cram-ai-smollm-q4_0.gguf /app/model-artifacts/cram-ai-smollm-q4_0.gguf
COPY model-artifacts/cram-ai-smollm/training_metadata.json /app/model-artifacts/cram-ai-smollm/training_metadata.json
EXPOSE 8000
CMD ["uvicorn","api:app","--app-dir","model-training","--host","0.0.0.0","--port","8000"]
