# CRAM AI API container deployment

This Dockerfile serves the saved CRAM AI LoRA adapter through the real FastAPI app. It does not use Gemini, OpenAI, Claude, or any hosted generation fallback.

## Required artifacts and runtime

- The branch must contain `model-artifacts/cram-ai/` with adapter weights, tokenizer files, `training_metadata.json`, and `TRAINING_FINISHED`.
- The container downloads the `distilgpt2` base model from Hugging Face when the app starts unless the host supplies a pre-cached model. The adapter alone is not a standalone model.
- Allow outbound HTTPS to Hugging Face, enough disk for model/cache files, and preferably at least 2 GB RAM for CPU inference. Free serverless tiers may OOM, sleep, or impose request timeouts; no free unlimited uptime is promised.
- Set `CORS_ORIGINS` to the exact dashboard origin after the API host is known. Do not set a secret or provider API key; this API does not need one.
- `GET /health` must report `model_loaded: true` before the API is considered ready. A 200 status with `model_loaded: false` is not a successful deployment.
- `POST /generate` accepts `{"prompt":"...","max_new_tokens":96,"temperature":0}`. Study endpoints return `output_valid` and do not claim malformed structured outputs are valid.

## Build and run

From the repository root after model artifacts have been committed:

```sh
docker build -t cram-ai-api .
docker run --rm -p 8000:8000 -e CORS_ORIGINS=https://cram-ai-model-lab-03bvh7.v2.appdeploy.ai cram-ai-api
```

This only builds and runs a local container. It does not create a public deployment by itself. After deploying to a persistent Python/container host, verify `GET /health` and several `POST /generate` questions before connecting the dashboard.
