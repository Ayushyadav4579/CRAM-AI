# CRAM AI model training (isolated from the existing frontend)

This adds a model-training area on the branch `agent/cram-ai-model-pipeline`; it does not rebuild or change the React dashboard or the current Gemini-dependent API routes.

## Automated run

A GitHub Actions workflow is configured to run on changes to this directory. It uses GitHub's standard public-repository **CPU** runner (not a GPU runner), installs open-source libraries, runs tests, downloads a public school-science dataset, fine-tunes DistilGPT2 with LoRA, evaluates on a separate test split, starts FastAPI and sends a real inference request. If all steps pass, the adapter weights, tokenizer and evaluation report are committed to `model-artifacts/` on this branch. A workflow artifact is also uploaded with 90-day retention.

This is a best-effort free CPU run. The standard runner has no guaranteed GPU, limited temporary disk, and a job time limit. If it times out, the cached checkpoints may allow a later run to resume. GitHub Actions permissions/settings can also prevent a workflow from pushing generated weights; the logs will show this rather than claiming success.

## Dataset source and limitations

The automated run uses [AI2 ARC](https://huggingface.co/datasets/allenai/ai2_arc), a school-level science multiple-choice dataset whose Hugging Face card tags it CC BY-SA 4.0. See its [dataset card](https://huggingface.co/datasets/allenai/ai2_arc) and [paper](https://arxiv.org/abs/1803.05457). The generated variants include multiple-choice answering, short answers, flashcards and revision Q&A. Every row retains a source ID and license label. Training/validation/test questions come from separate upstream splits; deduplication and split-leak checks are performed.

**This is not a full NCERT/CBSE corpus.** It is English school-level science practice data, not comprehensive notes for every subject. It does not automatically provide trusted chapter summaries, formula lists, definitions, poem interpretation or high-quality long answers. Those tasks require appropriately licensed source material and task-specific reviewed targets. The separate source-text pipeline below derives only what it can ground in supplied material; it does not invent MCQ distractors, false statements, mnemonics or glossary definitions.

## Build examples from material you own or may reuse

Input JSONL schema (one source per line):
```json
{"source_id":"notes-science-01","subject":"Science","grade":10,"text":"Ohm's law is defined as the relationship between current and potential difference. The equation is V = IR.","license":"user-provided","source_url":""}
```

Use content you own or that has an explicit reusable license. Do not commit copyrighted NCERT textbook pages wholesale without permission.

```bash
python model-training/dataset_pipeline.py --input model-training/data/sources.jsonl --output model-training/data/processed.jsonl --eval-output model-training/data/eval.jsonl
python model-training/dataset_pipeline.py --validate model-training/data/processed.jsonl
```

The pipeline deduplicates examples, keeps all variants of a source together in the held-out split, records provenance, and reports measured counts. Formula/definition/fill-blank tasks are emitted only when patterns can be extracted from source text. These heuristic transformations still need quality review.

## Training and evaluation commands

On an environment with enough compute:
```bash
python -m pip install -r model-training/requirements.txt
python model-training/prepare_public_dataset.py --output-dir model-training/data/public
python model-training/train.py --dataset model-training/data/public/train.jsonl --eval-dataset model-training/data/public/validation.jsonl --model-id distilgpt2 --output model-artifacts/cram-ai --epochs 1 --max-length 192 --resume
python model-training/evaluate.py --model model-artifacts/cram-ai --dataset model-training/data/public/test.jsonl --report model-artifacts/evaluation.json --limit 400
python model-training/smoke_test_api.py
```

Training uses response-only loss, LoRA, checkpoints, resume support, a weight SHA-256 manifest, and post-training tokenizer/weight checks. Evaluation reports held-out MCQ answer-key accuracy and answer text match rates; those metrics are imperfect proxies, and poor scores must be reported rather than hidden.

## FastAPI

```bash
MODEL_DIR=model-artifacts/cram-ai python -m uvicorn api:app --app-dir model-training --host 0.0.0.0 --port 8000
```

Endpoints: `GET /health`, `GET /model-info`, `POST /generate`, `POST /study/notes`, `POST /study/mcq`, `POST /study/flashcards`, `POST /study/summary`. It loads the trained LoRA adapter and its base model; if weights are missing or fail to load, generation returns HTTP 503. It contains no hosted AI fallback. To connect this to the existing CRAM frontend, the API needs a durable Python host with outbound access to download the base model or a separately stored base-model cache, plus CORS configuration. The existing Vercel frontend/serverless configuration is not a persistent GPU host.

## Durability and cost

The workflow commits the small adapter and tokenizer into this public repository branch after evaluation succeeds. It does not commit the full base model (which is downloaded separately) or any private study notes. The workflow artifact is retained for 90 days as a second copy. No paid GPU/service is configured or requested. If you later need a public model API with persistent storage, that hosting must be separately verified for free-tier limits before deployment.
