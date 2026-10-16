"""Start the real FastAPI process and verify model-backed inference."""
import json, os, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path
def request(url, data=None, timeout=120):
    payload=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request(url,data=payload,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=timeout) as res: return res.status,json.loads(res.read().decode())
def main():
    root=Path(__file__).resolve().parent
    model_dir=(root.parent/"model-artifacts"/"cram-ai").resolve()
    env=os.environ.copy(); env["MODEL_DIR"]=str(model_dir)
    log_path=root.parent/"model-artifacts"/"api-smoke.log"
    log_path.parent.mkdir(parents=True,exist_ok=True)
    log=open(log_path,"w")
    proc=subprocess.Popen([sys.executable,"-m","uvicorn","api:app","--host","127.0.0.1","--port","8765"],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    try:
        health=None
        deadline=time.time()+240
        while time.time()<deadline:
            if proc.poll() is not None: raise SystemExit("FastAPI exited before becoming healthy; inspect model-artifacts/api-smoke.log")
            try:
                status,health=request("http://127.0.0.1:8765/health",timeout=5)
                if status==200 and health.get("model_loaded"): break
            except Exception: time.sleep(3)
        if not health or not health.get("model_loaded"): raise SystemExit(f"Model API failed readiness check: {health}")
        status,result=request("http://127.0.0.1:8765/generate",{"prompt":"Explain in one sentence why plants need sunlight.","max_new_tokens":48,"temperature":0},timeout=180)
        answer=str(result.get("response","")).strip()
        if status!=200 or not answer: raise SystemExit("Model-backed /generate returned an empty answer.")
        print(json.dumps({"api_health":health,"inference_http_status":status,"unseen_prompt":"Explain in one sentence why plants need sunlight.","response":answer},ensure_ascii=False))
    finally:
        proc.terminate()
        try: proc.wait(timeout=15)
        except subprocess.TimeoutExpired: proc.kill()
        log.close()
if __name__=="__main__": main()
