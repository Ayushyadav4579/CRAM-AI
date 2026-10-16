"""Download CC BY-SA 4.0 AI2 ARC science questions and make deduplicated study tasks."""
import argparse, hashlib, json, random, re
from pathlib import Path
DATASET_ID="allenai/ai2_arc"
LICENSE="CC-BY-SA-4.0"
SOURCE_URL="https://huggingface.co/datasets/allenai/ai2_arc"
def key(s): return re.sub(r"\W+"," ",str(s).lower()).strip()
def digest(s): return hashlib.sha256(s.encode("utf-8")).hexdigest()
def load_split(config, split):
    from datasets import load_dataset
    return load_dataset(DATASET_ID,config,split=split)
def convert(row, config, split):
    question=str(row.get("question","")).strip()
    choices=row.get("choices") or {}
    labels=choices.get("label",[]) if isinstance(choices,dict) else []
    texts=choices.get("text",[]) if isinstance(choices,dict) else []
    answer_key=str(row.get("answerKey","")).strip()
    if not question or not answer_key or len(labels)!=len(texts) or answer_key not in labels: return []
    answer=texts[labels.index(answer_key)]
    if not answer: return []
    choices_text="\n".join(f"{lab}. {txt}" for lab,txt in zip(labels,texts))
    sid=f"{config}:{row.get('id') or digest(question)[:16]}"
    provenance={"source_id":sid,"source_url":SOURCE_URL,"license":LICENSE,"subject":"Science","grade":"school-level","source_split":split}
    mcq_instruction=f"Answer this school-level science multiple-choice question. Choose the best option and return its letter and text.\nQuestion: {question}\nOptions:\n{choices_text}"
    short_instruction=f"Answer this school-level science question using the choices as evidence. Give the correct option letter and answer text.\nQuestion: {question}\nOptions:\n{choices_text}"
    flash_instruction=f"Make one concise science revision flashcard from this question. Put the question on the front and the correct answer on the back.\nQuestion: {question}\nOptions:\n{choices_text}"
    revision_instruction=f"Create a short exam revision Q&A from this science question and its options.\nQuestion: {question}\nOptions:\n{choices_text}"
    common={"expected_key":answer_key,"expected_answer":answer}
    return [
      {**provenance,**common,"expected_key":answer_key,"task":"mcq","instruction":mcq_instruction,"response":f"Answer: {answer_key}. {answer}"},
      {**provenance,**common,"expected_key":"","task":"short_answer","instruction":short_instruction,"response":f"{answer_key}. {answer}"},
      {**provenance,**common,"expected_key":"","task":"flashcard","instruction":flash_instruction,"response":json.dumps({"front":question,"back":f"{answer_key}. {answer}"},ensure_ascii=False)},
      {**provenance,**common,"expected_key":"","task":"revision","instruction":revision_instruction,"response":f"Question: {question}\nAnswer: {answer_key}. {answer}"},
    ]
def build_rows(configs, split, limit=None, seed=42):
    out=[]; seen=set()
    per_config_limit = (limit + len(configs) - 1) // len(configs) if limit else None
    for config in configs:
        rows=list(load_split(config,split))
        if split=="train":
            random.Random(seed+sum(map(ord,config))).shuffle(rows)
        config_start_count=len({x["source_id"] for x in out})
        for row in rows:
            for r in convert(row,config,split):
                k=digest(key(r["instruction"])+"\n"+key(r["response"]))
                if k in seen: continue
                seen.add(k); out.append(r)
                if per_config_limit and len({x["source_id"] for x in out})-config_start_count>=per_config_limit: break
            if per_config_limit and len({x["source_id"] for x in out})-config_start_count>=per_config_limit: break
    return out
def write(path,rows):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("w",encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r,ensure_ascii=False)+"\n")
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output-dir",default="model-training/data/public")
    p.add_argument("--max-train-questions",type=int,default=1000)
    p.add_argument("--max-validation-questions",type=int,default=200)
    p.add_argument("--max-test-questions",type=int,default=200)
    p.add_argument("--seed",type=int,default=42)
    a=p.parse_args()
    out=Path(a.output_dir)
    train=build_rows(["ARC-Easy","ARC-Challenge"],"train",a.max_train_questions,a.seed)
    validation=build_rows(["ARC-Easy","ARC-Challenge"],"validation",a.max_validation_questions,a.seed)
    test=build_rows(["ARC-Easy","ARC-Challenge"],"test",a.max_test_questions,a.seed)
    if not train or not validation or not test: raise SystemExit("Dataset preparation produced an empty split; refusing to train.")
    train_ids={r["source_id"] for r in train}; val_ids={r["source_id"] for r in validation}; test_ids={r["source_id"] for r in test}
    if train_ids&val_ids or train_ids&test_ids or val_ids&test_ids: raise SystemExit("Source leakage detected across splits.")
    write(out/"train.jsonl",train); write(out/"validation.jsonl",validation); write(out/"test.jsonl",test)
    metadata={"dataset_id":DATASET_ID,"source_url":SOURCE_URL,"license":LICENSE,"license_url":"https://creativecommons.org/licenses/by-sa/4.0/","attribution":"Allen Institute for AI, AI2 ARC dataset; see dataset card and paper https://arxiv.org/abs/1803.05457","seed":a.seed,"train_questions":len(train_ids),"validation_questions":len(val_ids),"test_questions":len(test_ids),"train_examples":len(train),"validation_examples":len(validation),"test_examples":len(test),"task_counts":{split:{task:sum(r["task"]==task for r in rows) for task in sorted({r["task"] for r in rows})} for split,rows in [("train",train),("validation",validation),("test",test)]},"limitations":["English school-level science MCQs only; not a complete CBSE/NCERT corpus.","Generated variants share source question/answer and are not independent new facts.","No textbook notes, formulas, definitions, poems or long-answer corpus is included.","Model quality must be assessed on held-out data; nonempty output is not proof of correctness."]}
    (out/"dataset_metadata.json").write_text(json.dumps(metadata,indent=2),encoding="utf-8")
    print(json.dumps(metadata,ensure_ascii=False))
if __name__=="__main__": main()
