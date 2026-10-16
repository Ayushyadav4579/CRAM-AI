"""Local model-backed API. Missing/invalid model -> 503; never calls hosted AI services."""
import json, os
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
app=FastAPI(title="CRAM AI Local Model API",version="0.1.0")
origins=[x.strip() for x in os.getenv("CORS_ORIGINS","*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_methods=["GET","POST","OPTIONS"],allow_headers=["*"])
MODEL_DIR=Path(os.getenv("MODEL_DIR","artifacts/cram-ai"))
tokenizer=None; model=None; meta=None; load_error=None
try:
    if (MODEL_DIR/"training_metadata.json").exists() and (MODEL_DIR/"TRAINING_FINISHED").exists():
        from transformers import AutoTokenizer, AutoModelForCausalLM
        from peft import PeftModel
        meta=json.loads((MODEL_DIR/"training_metadata.json").read_text(encoding="utf-8"))
        tokenizer=AutoTokenizer.from_pretrained(MODEL_DIR)
        base=AutoModelForCausalLM.from_pretrained(meta["base_model"])
        model=PeftModel.from_pretrained(base,MODEL_DIR); model.eval()
except Exception as e: load_error=str(e)
def gen(prompt,limit=256,temperature=0.0):
    if model is None or tokenizer is None: raise HTTPException(503,detail={"error":"model_not_ready","message":"No verified trained CRAM AI model is loaded. No hosted fallback is configured.","load_error":load_error})
    if "### Response:" not in prompt:
        prompt=f"### Instruction:\n{prompt.strip()}\n### Response:\n"
    import torch
    inputs=tokenizer(prompt,return_tensors="pt",truncation=True,max_length=1024)
    kwargs={"max_new_tokens":limit,"do_sample":temperature>0,"pad_token_id":tokenizer.eos_token_id}
    if temperature>0: kwargs["temperature"]=temperature
    with torch.no_grad(): out=model.generate(**inputs,**kwargs)
    return tokenizer.decode(out[0][inputs["input_ids"].shape[1]:],skip_special_tokens=True).strip()
class GenerateRequest(BaseModel):
    prompt:str=Field(min_length=1,max_length=10000); max_new_tokens:int=Field(default=256,ge=1,le=512); temperature:float=Field(default=0.0,ge=0,le=1.2)
class StudyRequest(BaseModel):
    text:str=Field(min_length=1,max_length=16000); grade:Optional[int]=Field(default=10,ge=6,le=12); subject:str=Field(default="General",max_length=80); count:int=Field(default=8,ge=1,le=20)
@app.get("/health")
def health(): return {"status":"ready" if model is not None else "model_unavailable","model_loaded":model is not None,"model_dir":str(MODEL_DIR)}
@app.get("/model-info")
def model_info(): return {"name":"CRAM AI","model_loaded":model is not None,"metadata":meta,"load_error":load_error}
@app.post("/generate")
def generate(r:GenerateRequest): return {"response":gen(r.prompt,r.max_new_tokens,r.temperature)}
@app.post("/study/notes")
def notes(r:StudyRequest): return {"response":gen(f"### Instruction:\nWrite exam-ready notes for grade {r.grade} {r.subject} using only this source material:\n{r.text}\n### Response:\n",400)}
@app.post("/study/mcq")
def mcq(r:StudyRequest): return {"response":gen(f"### Instruction:\nCreate {r.count} MCQs with A/B/C/D options, correct answer and explanation for grade {r.grade} {r.subject}. If evidence is insufficient, say so. Source:\n{r.text}\n### Response:\n",512)}
@app.post("/study/flashcards")
def flashcards(r:StudyRequest): return {"response":gen(f"### Instruction:\nCreate {r.count} concise front/back flashcards for grade {r.grade} {r.subject} from this source:\n{r.text}\n### Response:\n",400)}
@app.post("/study/summary")
def summary(r:StudyRequest): return {"response":gen(f"### Instruction:\nSummarize this material for grade {r.grade} {r.subject}, preserving key facts and qualifications:\n{r.text}\n### Response:\n",320)}
