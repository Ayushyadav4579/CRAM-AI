"""Local CRAM AI model API. It never calls a hosted AI provider or fakes model output."""
import json, os, re, math
from pathlib import Path
from typing import Optional, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Render's free CPU instance is heavily constrained; avoid oversized BLAS thread pools.
os.environ.setdefault("OMP_NUM_THREADS","1")
os.environ.setdefault("MKL_NUM_THREADS","1")
os.environ.setdefault("OPENBLAS_NUM_THREADS","1")
import torch
torch.set_num_threads(1)
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass

app=FastAPI(title="CRAM AI Fine-tuned Model API",version="0.3.0")
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
        if meta.get("model_type")=="llama":
            # SmolLM2 is a compact instruction-tuned Llama-family model; FP16 reduces RAM on CPU hosting.
            base=AutoModelForCausalLM.from_pretrained(meta["base_model"],torch_dtype=__import__("torch").float16,low_cpu_mem_usage=True,local_files_only=os.getenv("HF_LOCAL_ONLY","0")=="1")
        else:
            base=AutoModelForCausalLM.from_pretrained(meta["base_model"])
        model=PeftModel.from_pretrained(base,MODEL_DIR)
        model.eval()
except Exception as e:
    load_error=f"{type(e).__name__}: {e}"

def gen(prompt:str,limit:int=96,temperature:float=0.0)->str:
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503,detail={"error":"model_not_ready","message":"The saved CRAM AI adapter is not loadable on this server. No hosted fallback is configured.","model_dir":str(MODEL_DIR),"load_error":load_error})
    prompt=prompt.strip()
    prompt_format=meta.get("prompt_format","instruction_response") if meta else "instruction_response"
    if prompt_format=="chat_template" and getattr(tokenizer,"chat_template",None):
        prompt=tokenizer.apply_chat_template([{"role":"user","content":prompt}],tokenize=False,add_generation_prompt=True)
    elif "### Response:" not in prompt:
        prompt=f"### Instruction:\n{prompt}\n### Response:\n"
    import torch
    inputs=tokenizer(prompt,return_tensors="pt",truncation=True,max_length=512)
    kwargs={"max_new_tokens":limit,"do_sample":temperature>0,"pad_token_id":tokenizer.eos_token_id,
            "eos_token_id":tokenizer.eos_token_id,"repetition_penalty":1.08,"use_cache":True,"max_time":25}
    if temperature>0: kwargs["temperature"]=temperature
    with torch.inference_mode():
        out=model.generate(**inputs,**kwargs)
    answer=tokenizer.decode(out[0][inputs["input_ids"].shape[1]:],skip_special_tokens=True).strip()
    # Prevent prompt-template leakage from being presented as an answer.
    answer=answer.split("### Instruction:",1)[0].split("### Response:",1)[0].strip()
    return answer

class GenerateRequest(BaseModel):
    prompt:str=Field(min_length=1,max_length=10000)
    max_new_tokens:int=Field(default=96,ge=1,le=192)
    temperature:float=Field(default=0.0,ge=0,le=1.0)

class StudyRequest(BaseModel):
    text:str=Field(min_length=1,max_length=12000)
    grade:Optional[int]=Field(default=10,ge=6,le=12)
    subject:str=Field(default="General",max_length=80)
    count:int=Field(default=8,ge=1,le=20)

class AskNotesRequest(BaseModel):
    question:str=Field(min_length=1,max_length=1500)
    text:str=Field(min_length=20,max_length=12000)
    grade:Optional[int]=Field(default=10,ge=6,le=12)
    subject:str=Field(default="General",max_length=80)

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
            "model_dir":str(MODEL_DIR),"base_model":meta.get("base_model") if meta else None,
            "model_type":meta.get("model_type") if meta else None,"generation_quality":"not_certified"}

@app.get("/model-info")
def model_info():
    return {"name":"CRAM AI","model_loaded":model is not None,"metadata":meta,"load_error":load_error,"model_dir":str(MODEL_DIR)}

def suspicious_generic_output(prompt:str,response:str)->bool:
    """Reject malformed JSON, repetitive fragments, question echoes, and gibberish."""
    text=response.strip()
    if not text:
        return True
    asks_for_structure=any(word in prompt.casefold() for word in ("flashcard","json","front and back"))
    try:
        parsed=json.loads(text)
    except (ValueError,TypeError):
        parsed=None
    if isinstance(parsed,dict):
        front,back=parsed.get("front"),parsed.get("back")
        if isinstance(front,str) and isinstance(back,str):
            if front.strip().casefold()==back.strip().casefold():
                return True
            if not asks_for_structure:
                return True
    if not asks_for_structure and (text.lstrip().startswith(("{","[")) or re.search(r'"(?:front|back)"\s*:',text,re.I)):
        return True
    normalized_prompt=" ".join(re.findall(r"[a-z0-9]+",prompt.casefold()))
    normalized_response=" ".join(re.findall(r"[a-z0-9]+",text.casefold()))
    normalized_response=re.sub(r"^(?:answer|response)\s+", "", normalized_response)
    question_core=re.split(r"\b(?:answer in|answer with|explain in|write in)\b",normalized_prompt,maxsplit=1)[0].strip()
    if len(question_core.split())>=3 and normalized_response.startswith(question_core):
        return True
    words=re.findall(r"[A-Za-z]{2,}",text.casefold())
    # Reject short, unfinished fragments such as a truncated "Answer: What".
    if len(words)<3 and not text.rstrip().endswith((".", "?", "!")):
        return True
    punctuation=sum(1 for ch in text if not ch.isalnum() and not ch.isspace())/max(1,len(text))
    if len(text)>12 and len(words)<2:
        return True
    if len(words)>=4 and len(set(words))/len(words)<0.45:
        return True
    if punctuation>0.25:
        return True
    return False


def validated_payload(response:str,kind:str)->dict[str,Any]:
    payload=result_payload(response,kind)
    if not payload["output_valid"]:
        raise HTTPException(status_code=502,detail={
            "error":"invalid_model_output",
            "output_format":kind,
            "message":"CRAM AI did not produce the required format. No hosted fallback is configured."
        })
    return payload

@app.post("/generate")
def generate(r:GenerateRequest):
    direct_prompt=("Answer the user's question directly in plain English. Do not return JSON, a flashcard, or repeat the question unless requested.\nQuestion: "+r.prompt)
    answer=gen(direct_prompt,min(r.max_new_tokens,48),r.temperature)
    first_attempt=answer
    if not answer.strip() or suspicious_generic_output(r.prompt,answer):
        # One bounded retry with a stronger plain-text instruction; never substitute a fake answer.
        retry_prompt=("Give a concise direct plain-text answer. Do not return JSON or a flashcard.\nQuestion: "+r.prompt)
        answer=gen(retry_prompt,min(r.max_new_tokens,24),0.0)
    if not answer.strip() or suspicious_generic_output(r.prompt,answer):
        raise HTTPException(status_code=502,detail={
            "error":"invalid_model_output",
            "message":"CRAM AI could not produce a usable plain-text answer after one retry. No hosted fallback is configured.",
            "first_attempt":first_attempt[:500],
            "retry_attempt":answer[:500]
        })
    return {"response":answer,"model":"CRAM AI fine-tuned adapter","model_loaded":True,"output_valid":True}

def retrieve_note_sentences(question:str,source:str)->list[str]:
    stop={"what","is","are","was","were","the","a","an","why","how","when","where","which","who","does","do","did","can","could","should","would","of","to","for","in","on","at","by","with","from","and","or","but","it","this","that","these","those","explain","tell","me","about","please"}
    terms=set(re.findall(r"[a-z0-9]+",question.casefold()))-stop
    if not terms:
        terms=set(re.findall(r"[a-z0-9]+",question.casefold()))
    sentences=[re.sub(r"\s+"," ",s).strip(" -•\t") for s in re.split(r"(?<=[.!?])\s+|\n+",source) if len(s.split())>=3]
    scored=[]
    for index,sentence in enumerate(sentences):
        words=set(re.findall(r"[a-z0-9]+",sentence.casefold()))
        overlap=terms & words
        if not overlap:
            continue
        score=len(overlap)/math.sqrt(max(1,len(words)))
        scored.append((score,index,sentence))
    if not scored:
        return []
    chosen=sorted(sorted(scored,key=lambda item:item[0],reverse=True)[:2],key=lambda item:item[1])
    return [item[2] for item in chosen]

@app.post("/study/answer")
def answer_from_notes(r:AskNotesRequest):
    sources=retrieve_note_sentences(r.question,r.text)
    if not sources:
        raise HTTPException(status_code=422,detail={
            "error":"insufficient_source_evidence",
            "message":"I could not find a relevant sentence in the supplied notes. Add the relevant paragraph or ask a narrower question."
        })
    # Return verbatim evidence rather than pretending a weak model paraphrase is verified.
    return {
        "response":"Based on your notes: "+" ".join(sources),
        "answer_mode":"extractive",
        "model":"source retrieval from user-provided notes",
        "model_loaded":model is not None,
        "output_valid":True,
        "sources":sources
    }

@app.post("/study/notes")
def notes(r:StudyRequest):
    answer=gen(f"Write clear exam-ready notes for grade {r.grade} {r.subject}. Use only this source material; organize key points and preserve formulas and definitions.\nSource material:\n{r.text}",384)
    return validated_payload(answer,"notes")

@app.post("/study/mcq")
def mcq(r:StudyRequest):
    answer=gen(f"Create {r.count} school-level {r.subject} MCQs for grade {r.grade} from the source below. Every question must have exactly four options labelled A, B, C, D, one correct answer letter, and a brief explanation. Do not invent facts. If source evidence is insufficient, say so.\nSource material:\n{r.text}",384)
    return validated_payload(answer,"mcq")

@app.post("/study/flashcards")
def flashcards(r:StudyRequest):
    answer=gen(f"Create one concise revision flashcard for grade {r.grade} {r.subject} from the source below. Return only a JSON object with string keys front and back, both non-empty and different.\nSource material:\n{r.text}",160)
    return validated_payload(answer,"flashcards")

@app.post("/study/summary")
def summary(r:StudyRequest):
    answer=gen(f"Write a concise revision summary for grade {r.grade} {r.subject}. Preserve key facts and qualifications; use only this source material.\nSource material:\n{r.text}",256)
    return validated_payload(answer,"summary")
