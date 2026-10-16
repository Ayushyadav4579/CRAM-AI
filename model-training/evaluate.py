"""Held-out generation smoke evaluation; reports measured results, not a fabricated benchmark."""
import argparse, json, re, sys
from pathlib import Path
def main():
    p=argparse.ArgumentParser(); p.add_argument("--model",required=True); p.add_argument("--dataset",required=True); p.add_argument("--report",default="artifacts/evaluation.json"); p.add_argument("--limit",type=int,default=100); a=p.parse_args()
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel
    model_dir=Path(a.model); data=Path(a.dataset)
    if not data.exists(): raise SystemExit(f"Evaluation data missing: {data}")
    if not (model_dir/"training_metadata.json").exists(): raise SystemExit("Missing training_metadata.json; refusing to label an unverified directory as a trained model.")
    tokenizer=AutoTokenizer.from_pretrained(model_dir)
    base_name=json.loads((model_dir/"training_metadata.json").read_text())["base_model"]
    base=AutoModelForCausalLM.from_pretrained(base_name)
    model=PeftModel.from_pretrained(base,model_dir); model.eval()
    rows=[json.loads(x) for x in data.read_text(encoding="utf-8").splitlines() if x.strip()][:a.limit]
    by_task={}; results=[]
    for r in rows:
        prompt=f"### Instruction:\n{r['instruction']}\n### Response:\n"
        inputs=tokenizer(prompt,return_tensors="pt",truncation=True,max_length=1024)
        with torch.no_grad(): out=model.generate(**inputs,max_new_tokens=160,do_sample=False,pad_token_id=tokenizer.eos_token_id)
        answer=tokenizer.decode(out[0][inputs["input_ids"].shape[1]:],skip_special_tokens=True).strip()
        rec={"task":r.get("task","unknown"),"source_id":r.get("source_id"),"nonempty":bool(answer),"answer_chars":len(answer),"answer":answer[:500]}
        results.append(rec); stat=by_task.setdefault(rec["task"],{"examples":0,"nonempty":0,"avg_answer_chars":0})
        stat["examples"]+=1; stat["nonempty"]+=int(bool(answer)); stat["avg_answer_chars"]+=len(answer)
    for s in by_task.values(): s["avg_answer_chars"]=round(s["avg_answer_chars"]/max(s["examples"],1),2)
    report={"model":str(model_dir),"eval_examples":len(results),"device":"cuda" if torch.cuda.is_available() else "cpu","nonempty_rate":sum(r["nonempty"] for r in results)/max(1,len(results)),"task_results":by_task,"samples":results}
    Path(a.report).parent.mkdir(parents=True,exist_ok=True); Path(a.report).write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="samples"},ensure_ascii=False))
    if not results or report["nonempty_rate"]<0.9: sys.exit(2)
if __name__=="__main__": main()
