"""Resumable LoRA fine-tuning. Does not promote output unless artifacts are verified."""
import argparse, hashlib, json, os, shutil, sys
from pathlib import Path
def sha256(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dataset",required=True); p.add_argument("--eval-dataset",required=True)
    p.add_argument("--model-id",default=os.getenv("BASE_MODEL","distilgpt2")); p.add_argument("--output",default="artifacts/cram-ai")
    p.add_argument("--epochs",type=float,default=1.0); p.add_argument("--max-length",type=int,default=512)
    p.add_argument("--resume",action="store_true"); a=p.parse_args()
    import torch
    from datasets import load_dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments, Trainer, DataCollatorForLanguageModeling
    from peft import LoraConfig, TaskType, get_peft_model
    if not Path(a.dataset).is_file() or not Path(a.eval_dataset).is_file(): raise SystemExit("Training and held-out evaluation JSONL files must both exist.")
    if Path(a.dataset).resolve()==Path(a.eval_dataset).resolve(): raise SystemExit("Refusing to train and evaluate on the same file.")
    train=load_dataset("json",data_files=a.dataset,split="train"); ev=load_dataset("json",data_files=a.eval_dataset,split="train")
    if len(train)<8 or len(ev)<2: raise SystemExit(f"Insufficient data: train={len(train)}, eval={len(ev)}. Add distinct reviewed source records.")
    device="cuda" if torch.cuda.is_available() else "cpu"
    print(json.dumps({"event":"preflight","model_id":a.model_id,"torch":torch.__version__,"device":device,"cuda_devices":torch.cuda.device_count(),"train_rows":len(train),"eval_rows":len(ev)}),flush=True)
    tokenizer=AutoTokenizer.from_pretrained(a.model_id)
    if tokenizer.pad_token is None: tokenizer.pad_token=tokenizer.eos_token
    base=AutoModelForCausalLM.from_pretrained(a.model_id)
    model_type=getattr(base.config,"model_type","")
    targets={"gpt2":["c_attn"],"gpt_neo":["q_proj","v_proj"],"llama":["q_proj","v_proj"],"mistral":["q_proj","v_proj"],"opt":["q_proj","v_proj"]}.get(model_type)
    if not targets: raise SystemExit(f"Unsupported/unknown model_type={model_type}; configure LoRA target modules explicitly rather than guessing.")
    model=get_peft_model(base,LoraConfig(task_type=TaskType.CAUSAL_LM,r=8,lora_alpha=16,lora_dropout=0.05,target_modules=targets))
    def fmt(x): return {"text":f"### Instruction:\n{x['instruction']}\n### Response:\n{x['response']}{tokenizer.eos_token}"}
    train=train.map(fmt); ev=ev.map(fmt)
    def tok(batch): return tokenizer(batch["text"],truncation=True,max_length=a.max_length)
    train=train.map(tok,batched=True,remove_columns=train.column_names)
    ev=ev.map(tok,batched=True,remove_columns=ev.column_names)
    out=Path(a.output); staging=out.with_name(out.name+".staging"); staging.mkdir(parents=True,exist_ok=True)
    args=TrainingArguments(output_dir=str(staging/"checkpoints"),num_train_epochs=a.epochs,per_device_train_batch_size=1,per_device_eval_batch_size=1,gradient_accumulation_steps=8,learning_rate=2e-4,logging_steps=5,save_strategy="steps",save_steps=50,save_total_limit=3,eval_strategy="epoch",load_best_model_at_end=True,metric_for_best_model="eval_loss",greater_is_better=False,report_to="none",fp16=torch.cuda.is_available(),gradient_checkpointing=torch.cuda.is_available(),resume_from_checkpoint=None)
    trainer=Trainer(model=model,args=args,train_dataset=train,eval_dataset=ev,data_collator=DataCollatorForLanguageModeling(tokenizer,mlm=False))
    resume=sorted((staging/"checkpoints").glob("checkpoint-*")) if a.resume else []
    trainer.train(resume_from_checkpoint=str(resume[-1]) if resume else None)
    trainer.save_model(str(staging/"adapter")); tokenizer.save_pretrained(str(staging/"adapter"))
    weights=list((staging/"adapter").glob("*.safetensors"))+list((staging/"adapter").glob("*.bin"))
    if not weights or not (staging/"adapter"/"tokenizer.json").exists(): raise SystemExit("Post-train verification failed: adapter weights or tokenizer missing.")
    report={"base_model":a.model_id,"model_type":model_type,"training_rows":len(train),"evaluation_rows":len(ev),"device":device,"torch":torch.__version__,"trainer_metrics":trainer.state.log_history,"files":{f.name:sha256(f) for f in weights}}
    (staging/"training_metadata.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    # Keep prior verified output until new run passes file checks.
    backup=out.with_name(out.name+".previous")
    if backup.exists(): shutil.rmtree(backup)
    if out.exists(): out.rename(backup)
    (staging/"adapter").rename(out)
    shutil.copy2(staging/"training_metadata.json",out/"training_metadata.json")
    (out/"TRAINING_FINISHED").write_text("trainer.train() returned successfully; evaluate and load-test before production use.\n")
    print(json.dumps({"event":"weights_verified","output":str(out),"weight_files":[str(x) for x in out.glob("*.safetensors")],"metadata":str(out/"training_metadata.json")}),flush=True)
if __name__=="__main__": main()
