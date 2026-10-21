---
base_model: HuggingFaceTB/SmolLM2-135M-Instruct
library_name: peft
pipeline_tag: text-generation
tags:
  - lora
  - transformers
  - education
---

# CRAM AI — study-focused fine-tuning adapter

CRAM AI is an independently fine-tuned adapter built on the open-weight SmolLM2-135M-Instruct base model. It is intended for experimentation with school-study prompts and source-grounded revision workflows. This adapter is not a foundation model trained from scratch.

## How it was trained

The pipeline uses LoRA fine-tuning with response-only loss on instruction/response variants derived from the openly available AI2 ARC science question dataset (Easy and Challenge splits). Train, validation, and test questions are kept separate and deduplicated across splits. See `training_metadata.json` and `dataset_metadata.json` for the exact run's counts and settings.

## Use and limitations

- Intended for educational prototyping and answer drafting, not authoritative grading or unsupervised factual use.
- The 135M parameter base is small; it is not expected to match Gemini or other large frontier models.
- A low training loss is not evidence of factual accuracy. Use the held-out evaluation report for measured performance.
- Verify generated facts, calculations, answer keys, and textbook-specific details against the student's prescribed source.
- For answers based on user-provided notes, prefer CRAM AI's extractive `/study/answer` endpoint, which returns source sentences.

## Run locally

Load the base model with PEFT and the saved adapter using the Hugging Face Transformers and PEFT libraries. The deployed low-memory version is exported to GGUF Q4_0 for llama.cpp CPU inference; it is the same adapter only when the export workflow completes successfully and commits the resulting artifact.

## Provenance

Base model: `HuggingFaceTB/SmolLM2-135M-Instruct`. Training data: ARC question splits prepared by `model-training/prepare_public_dataset.py`. This repository's workflow logs and evaluation artifacts are the source of truth for the latest trained version and its measured quality.
