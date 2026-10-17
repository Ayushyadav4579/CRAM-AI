"""Smoke-test real model loading and reject obvious malformed/echoed answers."""
import json, os, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

def request(url,data=None,timeout=120):
    payload=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request(url,data=payload,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=timeout) as res: return res.status,json.loads(res.read().decode())

def main():
    root=Path(__file__).resolve().parent
    model_dir=Path(os.environ.get("MODEL_DIR",str(root.parent/"model-artifacts"/"cram-ai"))).resolve()
    env=os.environ.copy(); env["MODEL_DIR"]=str(model_dir)
    log_path=root.parent/"model-artifacts"/"api-smoke.log"
    log_path.parent.mkdir(parents=True,exist_ok=True)
    with open(log_path,"w",encoding="utf-8") as log:
        proc=subprocess.Popen([sys.executable,"-m","uvicorn","api:app","--host","127.0.0.1","--port","8765"],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
        try:
            health=None; deadline=time.time()+240
            while time.time()<deadline:
                if proc.poll() is not None: raise SystemExit("FastAPI exited before healthy; inspect model-artifacts/api-smoke.log")
                try:
                    status,health=request("http://127.0.0.1:8765/health",timeout=5)
                    if status==200 and health.get("model_loaded"): break
                except Exception: time.sleep(3)
            if not health or not health.get("model_loaded"): raise SystemExit(f"Model API failed readiness: {health}")
            questions=[
                ("Explain in one sentence why plants need sunlight.",("photosynthesis","energy","food","grow")),
                ("What is the main purpose of photosynthesis?",("glucose","food","energy","photosynthesis")),
                ("Answer this MCQ and return the answer letter first: Which gas do plants absorb for photosynthesis? A. Oxygen B. Carbon dioxide C. Nitrogen D. Hydrogen",("b","carbon dioxide")),
            ]
            outputs=[]
            for prompt,expected_terms in questions:
                status,result=request("http://127.0.0.1:8765/generate",{"prompt":prompt,"max_new_tokens":64,"temperature":0},timeout=180)
                answer=str(result.get("response","")).strip()
                low=answer.casefold()
                looks_like_echo=not answer or low in prompt.casefold() or low.startswith('{"front"') or "### instruction:" in low
                relevant=(bool(__import__("re").search(r"^\s*(?:answer\s*[:\-]?\s*)?B(?:[.)\s:\-]|$)",answer,__import__("re").I)) or "carbon dioxide" in low) if "Answer this MCQ" in prompt else any(term in low for term in expected_terms)
                outputs.append({"prompt":prompt,"http_status":status,"response":answer,"looks_like_echo_or_malformed":looks_like_echo,"contains_expected_concept":relevant})
                if status!=200 or looks_like_echo or not relevant:
                    raise SystemExit("Model output quality smoke test failed: "+json.dumps(outputs,ensure_ascii=False))
            print(json.dumps({"api_health":health,"tests_passed":len(outputs),"outputs":outputs},ensure_ascii=False))
        finally:
            proc.terminate()
            try: proc.wait(timeout=15)
            except subprocess.TimeoutExpired: proc.kill()
if __name__=="__main__": main()
