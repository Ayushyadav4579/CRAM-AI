# CRAM AI model training (separate from the frontend)

This directory adds a reproducible model pipeline without changing the existing React dashboard or Gemini-dependent routes. It does **not** contain trained weights.

## Honest constraints
- This repository's app/API deployment is not a persistent GPU training worker.
- The current execution environment has CPU-only PyTorch and no CUDA device.
- Free Colab and Kaggle GPU access is conditional on the user's account, quota and capacity. Their authentication/session cannot be silently used from this repository.
- Do not claim a trained model until `artifacts/cram-ai/` contains verified weights/tokenizer and `evaluate.py` succeeds.

## Dataset
Provide source material as JSONL records with `text`, `source_id`, `subject`, `grade`, `license`, and `source_url`. Use material you own or that is legally reusable; do not copy NCERT textbooks wholesale. Example:
```json
{"source_id":"my-notes-01","subject":"Science","grade":10,"text":"Ohm's law states that current is directly proportional to potential difference when physical conditions remain constant.","license":"user-provided","source_url":""}
```
Run:
```bash
python model-training/dataset_pipeline.py --input model-training/data/sources.jsonl --output model-training/data/processed.jsonl --eval-output model-training/data/eval.jsonl
python model-training/dataset_pipeline.py --validate model-training/data/processed.jsonl
``
The generator produces task transformations only from supplied source text. Counts are measured after validation/deduplication; it never pads the data to hit a target. Evaluation split is grouped by source_id so variants of the same source do not leak across train/eval.

## Fine-tuning
Python 3.10/3.11 is recommended. On a GPU runtime:
```bash
pip install -r model-training/requirements.txt
python model-training/train.py --dataset model-training/data/processed.jsonl --eval-dataset model-training/data/eval.jsonl --model-id distilgpt2 --output artifacts/cram-ai
python model-training/evaluate.py --model artifacts/cram-ai --dataset model-training/data/eval.jsonl --report artifacts/evaluation.json
``
DistilGPT2 is only the conservative starter default, not a claim that it is the strongest possible model. Pick a base model only after checking license, VRAM and disk. Checkpoints are resumable. The final directory is promoted only after training returns successfully and weights/tokenizer files exist.

## API
```bash
MODEL_DIR=artifacts/cram-ai uvicorn model-training.api:app --host 0.0.0.0 --port 8000
``
Endpoints: `GET /health`, `GET /model-info`, `POST /generate`, `POST /study/notes`, `POST /study/mcq`, `POST /study/flashcards`, `POST /study/summary`. If weights aren't loadable, inference responds with HTTP 503; no hosted AI fallback is present.

## What this does not do
This pipeline does not autonomously log in to Google/Kaggle, allocate a GPU, or persist artifacts to a third-party drive. Those services require user authorization and their free resource availability is not guaranteed. Keep durable artifacts in a user-controlled repository release/object store/Drive after a successful run; do not assume a runtime's local disk persists.
