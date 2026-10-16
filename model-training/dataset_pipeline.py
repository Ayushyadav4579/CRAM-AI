"""Build grounded task examples from licensed/user-provided source text; stdlib only."""
import argparse, hashlib, json, re, sys
from pathlib import Path
from collections import Counter

REQUIRED=("instruction","response","task","source_id","license")
def norm(s): return re.sub(r"\s+"," ",re.sub(r"[^\w\s]"," ",str(s).lower())).strip()
def digest(s): return hashlib.sha256(s.encode("utf-8")).hexdigest()
def load_jsonl(path):
    rows=[]
    for n,line in enumerate(Path(path).open(encoding="utf-8"),1):
        if not line.strip(): continue
        try: rows.append(json.loads(line))
        except Exception as e: raise ValueError(f"{path}:{n}: invalid JSON: {e}")
    return rows
def sentences(text):
    return [x.strip() for x in re.split(r"(?<=[.!?])\s+",re.sub(r"\s+"," ",text.strip())) if len(x.strip())>=12]
def source_valid(s):
    return isinstance(s.get("text"),str) and len(s["text"].strip())>=35 and bool(str(s.get("source_id","")).strip()) and bool(str(s.get("license","")).strip())
def definition_match(sentence):
    m=re.match(r"^(.{2,70}?)\s+(?:is defined as|is called|refers to|means|is|are)\s+(.{5,180})[.!]?$",sentence,re.I)
    return (m.group(1).strip(),m.group(2).strip().rstrip(".!")) if m else None
def make_examples(s):
    text=re.sub(r"\s+"," ",s["text"]).strip()
    parts=sentences(text)
    if not parts: return
    subject=str(s.get("subject","General")); grade=str(s.get("grade","unspecified"))
    sid=str(s["source_id"]); lic=str(s["license"]); url=str(s.get("source_url",""))
    provenance={"source_id":sid,"subject":subject,"grade":grade,"license":lic,"source_url":url}
    notes="\n".join(f"- {sentence}" for sentence in parts[:8])
    summary=" ".join(parts[:min(3,len(parts))])
    yield {**provenance,"task":"notes","instruction":f"Create clear, source-grounded study notes for grade {grade} {subject}. Keep the important facts and do not add information.","response":notes}
    yield {**provenance,"task":"summary","instruction":f"Write a concise extractive revision summary of this {subject} source. Use only statements supported by the source.","response":summary}
    yield {**provenance,"task":"short_answer","instruction":f"State the main idea in this grade {grade} {subject} material in a short answer, using only the source.","response":parts[0]}
    yield {**provenance,"task":"long_answer","instruction":f"Write a clear, organized explanation of the supplied {subject} material for grade {grade}. Do not add facts beyond the source.","response":"The source explains the following points:\n"+"\n".join(f"{i+1}. {p}" for i,p in enumerate(parts[:8]))}
    yield {**provenance,"task":"flashcard","instruction":f"Create one source-grounded revision flashcard for {subject}.","response":json.dumps({"front":"What is the main point stated in the source?","back":parts[0]},ensure_ascii=False)}
    yield {**provenance,"task":"revision","instruction":f"Make quick last-minute revision points from this {subject} material.","response":notes}
    if len(parts)>=2:
        yield {**provenance,"task":"mind_map","instruction":f"Make a simple text mind map of the ideas explicitly stated in this {subject} source.","response":f"{subject} / Central topic\n"+"\n".join(f"├── {p}" for p in parts[:6])}
    for sentence in parts:
        pair=definition_match(sentence)
        if pair:
            term,meaning=pair
            yield {**provenance,"task":"definition","instruction":f"According to the supplied source, what does '{term}' mean?","response":f"{term}: {meaning}"}
            yield {**provenance,"task":"fill_blank","instruction":f"Create a fill-in-the-blank question using this source sentence: {sentence}","response":json.dumps({"question":re.sub(re.escape(term), "________", sentence, count=1, flags=re.I),"answer":term},ensure_ascii=False)}
            break
    formulas=[x.strip() for x in re.findall(r"[^\n.!?]{0,100}(?:=|\+|−|\b[A-Za-z]\s*/\s*[A-Za-z])[^\n.!?]{0,100}",text) if len(x.strip())>=3]
    if formulas:
        yield {**provenance,"task":"formula","instruction":f"Extract a formula or equation explicitly present in this {subject} source. Do not invent variables or units.","response":"Formula/equation from source: "+formulas[0]}
def validate_rows(rows):
    errors=[]; seen=set(); valid=[]
    for i,r in enumerate(rows,1):
        missing=[k for k in REQUIRED if not isinstance(r.get(k),str) or not r[k].strip()]
        if missing: errors.append({"line":i,"error":"missing/empty fields: "+",".join(missing)}); continue
        if len(r["instruction"].strip())<8 or len(r["response"].strip())<8:
            errors.append({"line":i,"error":"instruction or response too short"}); continue
        key=digest(norm(r["instruction"])+"\n"+norm(r["response"]))
        if key in seen: continue
        seen.add(key); valid.append(r)
    return valid,errors
def near_duplicate(a,b):
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
    p.add_argument("--eval-output",default="model-training/data/eval.jsonl"); p.add_argument("--eval-fraction",type=float,default=0.15)
    p.add_argument("--validate"); a=p.parse_args()
    if a.validate:
        rows=load_jsonl(a.validate); valid,errors=validate_rows(rows)
        print(json.dumps({"file":a.validate,"rows":len(rows),"valid_unique":len(valid),"errors":errors[:20]},ensure_ascii=False))
        sys.exit(1 if errors else 0)
    if not a.input: p.error("--input is required unless --validate is used")
    if not 0.05<=a.eval_fraction<=0.4: p.error("--eval-fraction must be 0.05–0.4")
    sources=load_jsonl(a.input); rejected=[i for i,s in enumerate(sources,1) if not source_valid(s)]; usable=[s for s in sources if source_valid(s)]
    ids=sorted({str(s["source_id"]) for s in usable})
    if len(ids)<2: raise SystemExit("Need at least two valid, distinct source_id values for a grouped held-out split.")
    eval_ids={sid for sid in ids if int(digest(sid)[:8],16)/0xffffffff<a.eval_fraction}
    if not eval_ids: eval_ids={ids[-1]}
    if len(eval_ids)==len(ids): eval_ids={ids[0]}
    generated=[]
    for source in usable:
        for row in make_examples(source) or []: generated.append(row)
    valid,errors=validate_rows(generated)
    filtered=[]; near_removed=0
    for row in valid:
        if any(norm(row["instruction"])==norm(prev["instruction"]) and near_duplicate(row["response"],prev["response"]) for prev in filtered):
            near_removed+=1; continue
        filtered.append(row)
    train=[r for r in filtered if r["source_id"] not in eval_ids]
    ev=[r for r in filtered if r["source_id"] in eval_ids]
    if not train or not ev: raise SystemExit("Grouped split produced an empty partition; provide more distinct source documents.")
    write_jsonl(a.output,train); write_jsonl(a.eval_output,ev)
    report={"source_rows":len(sources),"usable_sources":len(usable),"rejected_source_lines":rejected,"generated_examples":len(generated),"valid_unique_examples":len(valid),"near_duplicates_removed":near_removed,"training_examples":len(train),"evaluation_examples":len(ev),"training_source_count":len({r["source_id"] for r in train}),"held_out_source_ids":sorted(eval_ids),"task_counts_train":dict(Counter(r["task"] for r in train)),"task_counts_eval":dict(Counter(r["task"] for r in ev)),"note":"Only source-supported transformations are emitted. Definitions, blanks and formulas are conditional on detectable source patterns. MCQs, true/false distractors, mnemonics and difficult-word glossaries are not fabricated from arbitrary text; use a vetted, appropriately licensed source dataset for those tasks."}
    print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__": main()
