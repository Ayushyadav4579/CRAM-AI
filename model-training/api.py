"""Local CRAM AI model API. It never calls a hosted AI provider or fakes model output."""
import json, os, re
from pathlib import Path
from typing import Optional, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app=FastAPI(title="CRAM AI Fine-tuned Model API",version="0.2.0")
origins=[x.strip() for x in os.getenv("CORS_ORIGINS","*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_methods=["GET","POST","OPTIONS"],allow_headers=["*"])

HERE=Path(__file__).resolve().parent
configured=os.getenv("MODEL_DIR")
_candidates=[Path(configured)] if configured else [HERE.parent/"model-artifacts"/"cram-ai",Path.cwd()/"model-artifacts"/"cram-ai",Path.cwd()/"artifacts"/"cram-ai"]
MODEL_DIR=next((p.resolve() for p in _candidates if (p/"training_metadata.json").is_file() and (p/"TRAINING_FINISHED").is_file()),_candidates[0].resolve())
tokenizer=None; model=None; meta=None; load_error=None
try:
    if (MODEL_DIR/"training_metadata.json").is_file() and (MODEL_DIR/"TRAINING_FINISHED").is_file():
        from transformers import AutoTokenizer,AutoModelForCausalLM
        from peft import PeftModel
        meta=json.loads((MODEL_DIR/"training_metadata.json").read_text(encoding="utf-8"))
        tokenizer=AutoTokenizer.from_pretrained(MODEL_DIR)
        base=AutoModelForCausalLM.from_pretrained(meta["base_model"])
        model=PeftModel.from_pretrained(base,MODEL_DIR)
        model.eval()
except Exception as e:
    load_error=f"{type(e).__name__}: {e}"

def gen(prompt:str,limit:int=192,temperature:float=0.0)->str:
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503,detail={"error":"model_not_ready","message":"The saved CRAM AI adapter is not loadable on this server. No hosted fallback is configured.","model_dir":str(MODEL_DIR),"load_error":load_error})
    prompt=prompt.strip()
    if "### Response:" not in prompt:
        prompt=f"### Instruction:\n{prompt}\n### Response:\n"
    import torch
    inputs=tokenizer(prompt,return_tensors="pt",truncation=True,max_length=768)
    kwargs={"max_new_tokens":limit,"do_sample":temperature>0,"pad_token_id":tokenizer.eos_token_id,
            "eos_token_id":tokenizer.eos_token_id,"repetition_penalty":1.08}
    if temperature>0: kwargs["temperature"]=temperature
    with torch.inference_mode():
        out=model.generate(**inputs,**kwargs)
    answer=tokenizer.decode(out[0][inputs["input_ids"].shape[1]:],skip_special_tokens=True).strip()
    # Prevent prompt-template leakage from being presented as an answer.
    answer=answer.split("### Instruction:",1)[0].split("### Response:",1)[0].strip()
    return answer

class GenerateRequest(BaseModel):
    prompt:str=Field(min_length=1,max_length=10000)
    max_new_tokens:int=Field(default=192,ge=1,le=384)
    temperature:float=Field(default=0.0,ge=0,le=1.0)

class StudyRequest(BaseModel):
    text:str=Field(min_length=1,max_length=12000)
    grade:Optional[int]=Field(default=10,ge=6,le=12)
    subject:str=Field(default="General",max_length=80)
    count:int=Field(default=8,ge=1,le=20)

def result_payload(response:str,kind:str)->dict[str,Any]:
    payload={"response":response,"output_valid":bool(response.strip()),"structured":None,"output_format":kind}
    if kind=="flashcards":
        try:
            parsed=json.loads(response)
            if isinstance(parsed,dict) and isinstance(parsed.get("front"),str) and isinstance(parsed.get("back"),str) and parsed["front"].strip() and parsed["back"].strip() and parsed["front"].strip().casefold()!=parsed["back"].strip().casefold():
                payload["structured"]=parsed
            else: payload["output_valid"]=False
        except (ValueError,TypeError):
            payload["output_valid"]=False
    elif kind=="mcq":
        question_count=len(re.findall(r"(?im)^\s*(?:q(?:uestion)?\s*\d*[:.)-]|\d+[.)])\s*\S",response))
        option_count=len(re.findall(r"(?im)^\s*[A-D][.)]\s+\S",response))
        answer_count=len(re.findall(r"(?im)^\s*(?:correct answer|answer)\s*[:\-]\s*[A-D]\b",response))
        payload["output_valid"]=bool(question_count and option_count>=4 and answer_count)
    return payload

@app.get("/health")
def health():
    return {"status":"ready" if model is not None else "model_unavailable","model_loaded":model is not None,
            "model_dir":str(MODEL_DIR),"base_model":meta.get("base_model") if meta else None}

@app.get("/model-info")
def model_info():
    return {"name":"CRAM AI","model_loaded":model is not None,"metadata":meta,"load_error":load_error,"model_dir":str(MODEL_DIR)}

@app.post("/generate")
def generate(r:GenerateRequest):
    answer=gen(r.prompt,r.max_new_tokens,r.temperature)
    return {"response":answer,"model":"CRAM AI fine-tuned adapter","model_loaded":True,"output_valid":bool(answer)}

@app.post("/study/notes")
def notes(r:StudyRequest):
    answer=gen(f"Write clear exam-ready notes for grade {r.grade} {r.subject}. Use only this source material; organize key points and preserve formulas and definitions.\nSource material:\n{r.text}",384)
    return result_payload(answer,"notes")

@app.post("/study/mcq")
def mcq(r:StudyRequest):
    answer=gen(f"Create {r.count} school-level {r.subject} MCQs for grade {r.grade} from the source below. Every question must have exactly four options labelled A, B, C, D, one correct answer letter, and a brief explanation. Do not invent facts. If source evidence is insufficient, say so.\nSource material:\n{r.text}",384)
    return result_payload(answer,"mcq")

@app.post("/study/flashcards")
def flashcards(r:StudyRequest):
    answer=gen(f"Create one concise revision flashcard for grade {r.grade} {r.subject} from the source below. Return only a JSON object with string keys front and back, both non-empty and different.\nSource material:\n{r.text}",160)
    return result_payload(answer,"flashcards")

@app.post("/study/summary")
def summary(r:StudyRequest):
    answer=gen(f"Write a concise revision summary for grade {r.grade} {r.subject}. Preserve key facts and qualifications; use only this source material.\nSource material:\n{r.text}",256)
    return result_payload(answer,"summary")
