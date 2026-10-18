FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 MODEL_DIR=/app/model-artifacts/cram-ai HF_HOME=/opt/huggingface HF_LOCAL_ONLY=1
WORKDIR /app
COPY requirements-api.txt /app/requirements-api.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple \
 && pip install --no-cache-dir -r /app/requirements-api.txt
RUN python -c "from transformers import AutoTokenizer, AutoModelForCausalLM; import torch; m='HuggingFaceTB/SmolLM2-135M-Instruct'; AutoTokenizer.from_pretrained(m); AutoModelForCausalLM.from_pretrained(m, torch_dtype=torch.float16, low_cpu_mem_usage=True)"
COPY model-training /app/model-training
COPY model-artifacts/cram-ai /app/model-artifacts/cram-ai
COPY model-artifacts/cram-ai-smollm /app/model-artifacts/cram-ai-smollm
EXPOSE 8000
CMD ["uvicorn","api:app","--app-dir","model-training","--host","0.0.0.0","--port","8000"]
