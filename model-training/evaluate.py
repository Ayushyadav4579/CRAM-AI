"""Evaluate the trained adapter on the untouched AI2 ARC test split."""
import argparse, json, re
from pathlib import Path
def norm(s): return re.sub(r"[^a-z0-9]+"," ",str(s).lower()).strip()
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
    if not (model_dir/"training_metadata.json").exists() or not (model_dir/"TRAINING_FINISHED").exists(): raise SystemExit("No verified trained model metadata; refusing to evaluate an unverified directory.")
    meta=json.loads((model_dir/"training_metadata.json").read_text(encoding="utf-8"))
    tokenizer=AutoTokenizer.from_pretrained(model_dir)
    base=AutoModelForCausalLM.from_pretrained(meta["base_model"])
    model=PeftModel.from_pretrained(base,model_dir); model.eval()
    rows=[json.loads(x) for x in data.read_text(encoding="utf-8").splitlines() if x.strip()][:a.limit]
    results=[]
    for i,r in enumerate(rows,1):
        prompt=f"### Instruction:\n{r['instruction']}\n### Response:\n"
        inputs=tokenizer(prompt,return_tensors="pt",truncation=True,max_length=512)
        with torch.no_grad():
            out=model.generate(**inputs,max_new_tokens=64,do_sample=False,pad_token_id=tokenizer.eos_token_id)
        answer=tokenizer.decode(out[0][inputs["input_ids"].shape[1]:],skip_special_tokens=True).strip()
        expected_key=r.get("expected_key","")
        match=bool(expected_key and re.search(r"(?i)(?:answer|option|correct option)?\s*[:\-]?\s*"+re.escape(expected_key)+r"\b",answer))
        expected=r.get("expected_answer","")
        answer_match=bool(expected and norm(expected) and norm(expected) in norm(answer))
        results.append({"task":r.get("task","unknown"),"source_id":r.get("source_id"),"expected_key":expected_key,"expected_answer":expected,"predicted":answer[:400],"mcq_key_correct":match if expected_key else None,"answer_text_match":answer_match if expected else None,"nonempty":bool(answer)})
        if i%25==0: print(json.dumps({"event":"evaluation_progress","completed":i,"total":len(rows)}),flush=True)
    tasks={}
    for r in results:
        s=tasks.setdefault(r["task"],{"examples":0,"nonempty":0,"key_scored":0,"key_correct":0,"answer_scored":0,"answer_text_matches":0})
        s["examples"]+=1; s["nonempty"]+=int(r["nonempty"])
        if r["mcq_key_correct"] is not None: s["key_scored"]+=1; s["key_correct"]+=int(r["mcq_key_correct"])
        if r["answer_text_match"] is not None: s["answer_scored"]+=1; s["answer_text_matches"]+=int(r["answer_text_match"])
    for s in tasks.values():
        s["nonempty_rate"]=round(s["nonempty"]/max(1,s["examples"]),4)
        s["mcq_key_accuracy"]=round(s["key_correct"]/s["key_scored"],4) if s["key_scored"] else None
        s["answer_text_match_rate"]=round(s["answer_text_matches"]/s["answer_scored"],4) if s["answer_scored"] else None
    scored=[r for r in results if r["mcq_key_correct"] is not None]
    report={"model_dir":str(model_dir),"base_model":meta["base_model"],"evaluation_dataset":str(data),"evaluated_examples":len(results),"device":"cuda" if torch.cuda.is_available() else "cpu","mcq_questions_scored":len(scored),"mcq_key_accuracy":round(sum(r["mcq_key_correct"] for r in scored)/len(scored),4) if scored else None,"nonempty_rate":round(sum(r["nonempty"] for r in results)/max(1,len(results)),4),"task_results":tasks,"samples":results}
    Path(a.report).parent.mkdir(parents=True,exist_ok=True); Path(a.report).write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="samples"},ensure_ascii=False))
if __name__=="__main__": main()
