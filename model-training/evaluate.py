"""Strict held-out evaluation: score the answer key at the start, not stray letters in prose."""
import argparse, json, re
from pathlib import Path

def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()

def parsed_key(text):
    # Only accept an explicit answer label at the start of the generated answer.
    m = re.match(r"^\s*(?:(?:answer|correct\s+option|option)\s*[:\-]?\s*)?([A-D])(?:\s*[.)\-:]|\s|$)", str(text), re.I)
    return m.group(1).upper() if m else None

def token_f1(expected, predicted):
    a, b = norm(expected).split(), norm(predicted).split()
    if not a or not b: return 0.0
    from collections import Counter
    common = sum((Counter(a) & Counter(b)).values())
    if not common: return 0.0
    precision, recall = common / len(b), common / len(a)
    return 2 * precision * recall / (precision + recall)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--model",required=True); p.add_argument("--dataset",required=True)
    p.add_argument("--report",default="model-artifacts/evaluation.json"); p.add_argument("--limit",type=int,default=300)
    a=p.parse_args()
    import torch
    from transformers import AutoTokenizer,AutoModelForCausalLM
    from peft import PeftModel
    model_dir=Path(a.model); data=Path(a.dataset)
    if not data.exists(): raise SystemExit(f"Evaluation data missing: {data}")
    if not (model_dir/"training_metadata.json").exists() or not (model_dir/"TRAINING_FINISHED").exists():
        raise SystemExit("No verified trained model metadata; refusing to evaluate an unverified directory.")
    meta=json.loads((model_dir/"training_metadata.json").read_text(encoding="utf-8"))
    tokenizer=AutoTokenizer.from_pretrained(model_dir)
    base=AutoModelForCausalLM.from_pretrained(meta["base_model"])
    model=PeftModel.from_pretrained(base,model_dir); model.eval()
    all_rows=[json.loads(x) for x in data.read_text(encoding="utf-8").splitlines() if x.strip()]
    # Score a meaningful number of MCQs across the entire held-out split,
    # rather than accidentally scoring only the first 100 questions because
    # each source question has four task variants stored next to each other.
    mcq_rows=[r for r in all_rows if r.get("task")=="mcq"]
    if not mcq_rows:
        raise SystemExit("Held-out dataset contains no MCQ rows; refusing to report accuracy.")
    rows=mcq_rows[:a.limit]
    other_tasks=sorted({str(r.get("task","unknown")) for r in all_rows if r.get("task")!="mcq"})
    per_task_limit=max(25,a.limit//8)
    for task in other_tasks:
        rows.extend([r for r in all_rows if r.get("task")==task][:per_task_limit])
    results=[]
    for i,r in enumerate(rows,1):
        prompt=f"### Instruction:\n{r['instruction']}\n### Response:\n"
        inputs=tokenizer(prompt,return_tensors="pt",truncation=True,max_length=512)
        with torch.no_grad():
            out=model.generate(**inputs,max_new_tokens=96,do_sample=False,pad_token_id=tokenizer.eos_token_id,
                               eos_token_id=tokenizer.eos_token_id,repetition_penalty=1.08)
        answer=tokenizer.decode(out[0][inputs["input_ids"].shape[1]:],skip_special_tokens=True).strip()
        expected_key=str(r.get("expected_key","")).strip().upper()
        predicted_key=parsed_key(answer)
        key_correct=(predicted_key==expected_key) if expected_key else None
        expected=str(r.get("expected_answer","")).strip()
        exact=bool(expected and norm(expected)==norm(answer))
        f1=round(token_f1(expected,answer),4) if expected else None
        results.append({"task":r.get("task","unknown"),"source_id":r.get("source_id"),
            "expected_key":expected_key or None,"predicted_key":predicted_key,"expected_answer":expected,
            "predicted":answer[:400],"mcq_key_correct":key_correct,"answer_text_exact":exact if expected else None,
            "answer_token_f1":f1,"nonempty":bool(answer)})
        if i%25==0: print(json.dumps({"event":"evaluation_progress","completed":i,"total":len(rows)}),flush=True)
    tasks={}
    for r in results:
        s=tasks.setdefault(r["task"],{"examples":0,"nonempty":0,"key_scored":0,"key_correct":0,
                                     "answer_scored":0,"answer_exact":0,"answer_token_f1_sum":0.0})
        s["examples"]+=1; s["nonempty"]+=int(r["nonempty"])
        if r["mcq_key_correct"] is not None:
            s["key_scored"]+=1; s["key_correct"]+=int(r["mcq_key_correct"])
        if r["answer_text_exact"] is not None:
            s["answer_scored"]+=1; s["answer_exact"]+=int(r["answer_text_exact"])
            s["answer_token_f1_sum"]+=r["answer_token_f1"] or 0.0
    for s in tasks.values():
        s["nonempty_rate"]=round(s["nonempty"]/max(1,s["examples"]),4)
        s["mcq_key_accuracy"]=round(s["key_correct"]/s["key_scored"],4) if s["key_scored"] else None
        s["answer_text_exact_match_rate"]=round(s["answer_exact"]/s["answer_scored"],4) if s["answer_scored"] else None
        s["mean_answer_token_f1"]=round(s["answer_token_f1_sum"]/s["answer_scored"],4) if s["answer_scored"] else None
        s.pop("answer_token_f1_sum",None)
    scored=[r for r in results if r["mcq_key_correct"] is not None]
    report={"model_dir":str(model_dir),"base_model":meta["base_model"],"evaluation_dataset":str(data),
        "evaluated_examples":len(results),"device":"cuda" if torch.cuda.is_available() else "cpu",
        "mcq_questions_scored":len(scored),"mcq_key_accuracy":round(sum(r["mcq_key_correct"] for r in scored)/len(scored),4) if scored else None,
        "mcq_scoring":"strict: generated answer must begin with an explicit A/B/C/D key; no stray-letter matches",
        "nonempty_rate":round(sum(r["nonempty"] for r in results)/max(1,len(results)),4),
        "task_results":tasks,"samples":results}
    Path(a.report).parent.mkdir(parents=True,exist_ok=True)
    Path(a.report).write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="samples"},ensure_ascii=False))
if __name__=="__main__": main()
