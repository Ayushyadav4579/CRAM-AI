"""Build instruction-response JSONL from permitted source snippets; stdlib only."""
import argparse, hashlib, json, re, sys
from pathlib import Path
from collections import Counter

REQUIRED = ("instruction", "response", "task", "source_id", "license")
TASKS = ("notes", "summary", "short_answer", "long_answer", "mcq", "flashcard",
         "definition", "fill_blank", "true_false", "revision", "formula")
def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s.lower())).strip()
def digest(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()
def load_jsonl(path):
    rows=[]
    for n,line in enumerate(Path(path).open(encoding="utf-8"),1):
        if not line.strip(): continue
        try: rows.append(json.loads(line))
        except Exception as e: raise ValueError(f"{path}:{n}: invalid JSON: {e}")
    return rows
def source_valid(s):
    return isinstance(s.get("text"),str) and len(s["text"].strip())>=35 and bool(s.get("source_id")) and bool(s.get("license"))
def make_examples(s):
    text=re.sub(r"\s+"," ",s["text"]).strip()
    subject=s.get("subject","General")
    grade=s.get("grade","unspecified")
    sid=str(s["source_id"]); license_=str(s["license"]); url=str(s.get("source_url",""))
    # Use extractive/faithful transformations: no invented fact is asserted as a verified answer.
    yield {"instruction":f"Write clear study notes for grade {grade} {subject} using only this material.","response":f"Study notes\n{text}","task":"notes"}
    yield {"instruction":f"Summarize this {subject} material for a grade {grade} student in 2–4 sentences.","response":text,"task":"summary"}
    yield {"instruction":f"Give a short answer based only on this supplied {subject} material: What is the key idea?","response":text,"task":"short_answer"}
    yield {"instruction":f"Explain the supplied {subject} material for a grade {grade} student. Preserve its qualifications and do not add unsupported facts.","response":f"Key explanation\n{text}\n\nCheck the prescribed syllabus or source for additional details.","task":"long_answer"}
    yield {"instruction":f"Make a flashcard from this {subject} material.","response":json.dumps({"front":"What is the key idea in the supplied material?","back":text},ensure_ascii=False),"task":"flashcard"}
    yield {"instruction":f"Create a last-minute revision note from this {subject} material.","response":f"Revision point: {text}","task":"revision"}
    yield {"instruction":f"Create a fill-in-the-blank exercise from this material without changing its meaning.","response":json.dumps({"prompt":"Complete the statement using the supplied material: [review the source text and fill in a key phrase].","source_text":text,"answer":"Use the exact key phrase from the supplied source text; verify before using as an exam question."},ensure_ascii=False),"task":"fill_blank"}
    yield {"instruction":f"Create a true/false practice item grounded in this source. Do not guess a claim that is not stated.","response":json.dumps({"statement":"The source text should be consulted to decide whether a claim about its content is true.","answer":True,"explanation":"This is a source-handling item, not a subject-fact question."},ensure_ascii=False),"task":"true_false"}
    # MCQ distractors are intentionally not invented from unrelated source snippets.
    yield {"instruction":f"Prepare one MCQ task from this {subject} material. If four defensible options cannot be made from the source alone, say so rather than inventing distractors.","response":json.dumps({"question":"Which answer is supported by the supplied material?","options":{"A":text,"B":"Not stated in the supplied material","C":"Contradicts the supplied material","D":"Cannot be determined without additional source evidence"},"answer":"A","explanation":"Option A repeats the source material; options B–D are epistemic distractors. Review for ambiguity before exam use."},ensure_ascii=False),"task":"mcq"}
    # Formula task is only a format template, not a claim that the source contains a formula.
    yield {"instruction":f"Extract formulas, symbols and units from this {subject} source for grade {grade}. Do not invent any.","response":f"Source material:\n{text}\n\nIf no formula, symbol, or unit is explicitly present, report 'None explicitly identified in this source.'","task":"formula"}
    yield {"instruction":f"Define difficult terms only when they are explicitly defined in this source; otherwise identify terms needing a trusted glossary.","response":f"Source for term checking:\n{text}\n\nDo not infer a textbook definition that is absent from this source.","task":"definition"}
    for task in TASKS:
        pass
    for row in ():
        yield row
def validate_rows(rows):
    errors=[]; seen=set(); valid=[]
    for i,r in enumerate(rows,1):
        missing=[k for k in REQUIRED if not isinstance(r.get(k),str) or not r[k].strip()]
        if missing: errors.append({"line":i,"error":"missing/empty fields: "+",".join(missing)}); continue
        key=digest(norm(r["instruction"])+"\n"+norm(r["response"]))
        if key in seen: continue
        seen.add(key); valid.append(r)
    return valid,errors
def near_duplicate(a,b):
    # Conservative word-shingle Jaccard heuristic; flags only very close examples.
    wa=norm(a).split(); wb=norm(b).split()
    if not wa or not wb: return False
    sa=set(zip(wa,wa[1:],wa[2:])) if len(wa)>=3 else set(zip(wa,wa[1:]))
    sb=set(zip(wb,wb[1:],wb[2:])) if len(wb)>=3 else set(zip(wb,wb[1:]))
    return bool(sa and sb) and len(sa&sb)/len(sa|sb)>=0.92
def write_jsonl(path,rows):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("w",encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r,ensure_ascii=False)+"\n")
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input"); p.add_argument("--output",default="model-training/data/processed.jsonl")
    p.add_argument("--eval-output",default="model-training/data/eval.jsonl")
    p.add_argument("--eval-fraction",type=float,default=0.15)
    p.add_argument("--validate")
    a=p.parse_args()
    if a.validate:
        rows=load_jsonl(a.validate); valid,errors=validate_rows(rows)
        print(json.dumps({"file":a.validate,"rows":len(rows),"valid_unique":len(valid),"errors":errors[:20]},ensure_ascii=False))
        sys.exit(1 if errors else 0)
    if not a.input: p.error("--input is required unless --validate is used")
    if not 0.05<=a.eval_fraction<=0.4: p.error("--eval-fraction must be 0.05–0.4")
    sources=load_jsonl(a.input); rejected=[i for i,s in enumerate(sources,1) if not source_valid(s)]
    usable=[s for s in sources if source_valid(s)]
    if len(usable)<2: raise SystemExit("Need at least two valid, distinct source_id records to create a grouped held-out set.")
    ids=sorted({str(s["source_id"]) for s in usable})
    # Stable deterministic split by source_id prevents source variants leaking across splits.
    eval_ids={sid for sid in ids if int(digest(sid)[:8],16)/0xffffffff<a.eval_fraction}
    if not eval_ids: eval_ids={ids[-1]}
    if len(eval_ids)==len(ids): eval_ids={ids[0]}
    generated=[]
    for s in usable:
        for r in make_examples(s):
            r.update({"source_id":str(s["source_id"]),"subject":str(s.get("subject","General")),"grade":str(s.get("grade","unspecified")),"license":str(s["license"]),"source_url":str(s.get("source_url",""))})
            generated.append(r)
    valid,errors=validate_rows(generated)
    # Similarity dedupe per instruction, using source-independent text; preserve first provenance.
    filtered=[]; near_removed=0
    for r in valid:
        if any(norm(r["instruction"])==norm(x["instruction"]) and near_duplicate(r["response"],x["response"]) for x in filtered):
            near_removed+=1; continue
        filtered.append(r)
    train=[r for r in filtered if r["source_id"] not in eval_ids]
    ev=[r for r in filtered if r["source_id"] in eval_ids]
    write_jsonl(a.output,train); write_jsonl(a.eval_output,ev)
    print(json.dumps({"source_rows":len(sources),"usable_sources":len(usable),"rejected_source_lines":rejected,"generated_examples":len(generated),"valid_unique_before_near_dedupe":len(valid),"near_duplicates_removed":near_removed,"training_examples":len(train),"evaluation_examples":len(ev),"task_counts_train":dict(Counter(r["task"] for r in train)),"task_counts_eval":dict(Counter(r["task"] for r in ev)),"held_out_source_ids":sorted(eval_ids),"warning":"Generated task transformations are not independently fact-checked; MCQ/TF/blank templates require review. No synthetic target count is promised."},ensure_ascii=False))
if __name__=="__main__": main()
