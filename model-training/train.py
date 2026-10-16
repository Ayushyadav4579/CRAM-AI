"""Resumable LoRA fine-tuning with response-only loss and verified promotion."""
import argparse, hashlib, json, os, shutil
from pathlib import Path

def sha256(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): h.update(block)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--dataset",required=True)
    parser.add_argument("--eval-dataset",required=True)
    parser.add_argument("--model-id",default=os.getenv("BASE_MODEL","distilgpt2"))
    parser.add_argument("--output",default="model-artifacts/cram-ai")
    parser.add_argument("--epochs",type=float,default=1.0)
    parser.add_argument("--max-length",type=int,default=192)
    parser.add_argument("--resume",action="store_true")
    a=parser.parse_args()
    import torch
    from datasets import load_dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments, Trainer
    from peft import LoraConfig, TaskType, get_peft_model
    for path in (a.dataset,a.eval_dataset):
        if not Path(path).is_file(): raise SystemExit(f"Required dataset missing: {path}")
    if Path(a.dataset).resolve()==Path(a.eval_dataset).resolve(): raise SystemExit("Refusing to train and evaluate on the same file.")
    train=load_dataset("json",data_files=a.dataset,split="train")
    ev=load_dataset("json",data_files=a.eval_dataset,split="train")
    if len(train)<8 or len(ev)<2: raise SystemExit(f"Insufficient data: train={len(train)}, eval={len(ev)}.")
    if not {"instruction","response"}.issubset(train.column_names): raise SystemExit("Dataset rows must include instruction and response.")
    device="cuda" if torch.cuda.is_available() else "cpu"
    print(json.dumps({"event":"preflight","model_id":a.model_id,"torch":torch.__version__,"device":device,"cuda_devices":torch.cuda.device_count(),"train_rows":len(train),"eval_rows":len(ev)}),flush=True)
    tokenizer=AutoTokenizer.from_pretrained(a.model_id)
    if tokenizer.pad_token is None: tokenizer.pad_token=tokenizer.eos_token
    tokenizer.padding_side="right"
    base=AutoModelForCausalLM.from_pretrained(a.model_id)
    model_type=getattr(base.config,"model_type","")
    targets={"gpt2":["c_attn"],"gpt_neo":["q_proj","v_proj"],"llama":["q_proj","v_proj"],"mistral":["q_proj","v_proj"],"opt":["q_proj","v_proj"]}.get(model_type)
    if not targets: raise SystemExit(f"Unsupported model_type={model_type}; refusing to guess LoRA target modules.")
    model=get_peft_model(base,LoraConfig(task_type=TaskType.CAUSAL_LM,r=8,lora_alpha=16,lora_dropout=0.05,target_modules=targets))
    def encode(row):
        prompt=f"### Instruction:\n{row['instruction'].strip()}\n### Response:\n"
        answer=row["response"].strip()+tokenizer.eos_token
        prompt_ids=tokenizer(prompt,add_special_tokens=False)["input_ids"]
        answer_ids=tokenizer(answer,add_special_tokens=False)["input_ids"][:max(8,a.max_length//3)]
        prompt_ids=prompt_ids[:max(1,a.max_length-len(answer_ids))]
        ids=prompt_ids+answer_ids
        labels=([-100]*len(prompt_ids))+answer_ids
        return {"input_ids":ids,"attention_mask":[1]*len(ids),"labels":labels}
    train=train.map(encode,remove_columns=train.column_names,desc="Tokenizing training examples")
    ev=ev.map(encode,remove_columns=ev.column_names,desc="Tokenizing validation examples")
    def collate(rows):
        max_len=max(len(x["input_ids"]) for x in rows)
        return {
          "input_ids":torch.tensor([x["input_ids"]+[tokenizer.pad_token_id]*(max_len-len(x["input_ids"])) for x in rows],dtype=torch.long),
          "attention_mask":torch.tensor([x["attention_mask"]+[0]*(max_len-len(x["attention_mask"])) for x in rows],dtype=torch.long),
          "labels":torch.tensor([x["labels"]+[-100]*(max_len-len(x["labels"])) for x in rows],dtype=torch.long),
        }
    out=Path(a.output); staging=out.with_name(out.name+".staging")
    checkpoint_dir=staging/"checkpoints"; checkpoint_dir.mkdir(parents=True,exist_ok=True)
    args=TrainingArguments(
      output_dir=str(checkpoint_dir),num_train_epochs=a.epochs,
      per_device_train_batch_size=1,per_device_eval_batch_size=1,
      gradient_accumulation_steps=8,learning_rate=2e-4,logging_steps=10,
      save_strategy="steps",save_steps=100,save_total_limit=3,
      eval_strategy="steps",eval_steps=100,load_best_model_at_end=True,
      metric_for_best_model="eval_loss",greater_is_better=False,
      report_to="none",seed=42,fp16=torch.cuda.is_available(),
      gradient_checkpointing=torch.cuda.is_available()
    )
    trainer=Trainer(model=model,args=args,train_dataset=train,eval_dataset=ev,data_collator=collate)
    checkpoints=sorted(checkpoint_dir.glob("checkpoint-*"),key=lambda p:int(p.name.split("-")[-1])) if a.resume else []
    resume=str(checkpoints[-1]) if checkpoints else None
    print(json.dumps({"event":"training_start","resume_from_checkpoint":resume,"output":str(out),"checkpoint_dir":str(checkpoint_dir)}),flush=True)
    result=trainer.train(resume_from_checkpoint=resume)
    trainer.save_model(str(staging/"adapter")); tokenizer.save_pretrained(str(staging/"adapter"))
    weights=list((staging/"adapter").glob("*.safetensors"))+list((staging/"adapter").glob("*.bin"))
    if not weights or not (staging/"adapter"/"tokenizer.json").exists(): raise SystemExit("Post-train verification failed: weights or tokenizer missing.")
    report={"base_model":a.model_id,"model_type":model_type,"training_rows":len(train),"validation_rows":len(ev),"device":device,"torch":torch.__version__,"train_metrics":result.metrics,"log_history":trainer.state.log_history,"weight_sha256":{f.name:sha256(f) for f in weights}}
    (staging/"training_metadata.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    backup=out.with_name(out.name+".previous")
    if backup.exists(): shutil.rmtree(backup)
    if out.exists(): out.rename(backup)
    (staging/"adapter").rename(out)
    shutil.copy2(staging/"training_metadata.json",out/"training_metadata.json")
    (out/"TRAINING_FINISHED").write_text("trainer.train() returned successfully; held-out evaluation is still required.\n")
    print(json.dumps({"event":"weights_verified","output":str(out),"weight_files":[{"path":str(x),"bytes":x.stat().st_size,"sha256":sha256(x)} for x in out.glob("*.safetensors")],"metadata":str(out/"training_metadata.json")}),flush=True)
if __name__=="__main__": main()
