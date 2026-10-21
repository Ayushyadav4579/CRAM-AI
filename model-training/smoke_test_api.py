"""Smoke-test real model loading and endpoint responses; report semantic quality without hiding model output."""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

def request(url, data=None, timeout=120):
    payload = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try: detail = json.loads(body)
        except ValueError: detail = {"detail": body[:1000]}
        return exc.code, detail

def main():
    root = Path(__file__).resolve().parent
    model_dir = (root.parent / "model-artifacts" / "cram-ai-smollm").resolve()
    env = os.environ.copy()
    env["MODEL_DIR"] = str(model_dir)
    log_path = root.parent / "model-artifacts" / "api-smoke.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", "8765"], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            health = None
            deadline = time.time() + 240
            while time.time() < deadline:
                if proc.poll() is not None:
                    raise SystemExit("FastAPI exited before healthy; inspect model-artifacts/api-smoke.log")
                status, candidate = request("http://127.0.0.1:8765/health", timeout=5)
                if status == 200 and candidate.get("model_loaded"):
                    health = candidate
                    break
                time.sleep(3)
            if not health:
                raise SystemExit(f"Model API failed readiness: {health}")
            questions = [
                ("Explain in one sentence why plants need sunlight.", ("photosynthesis", "energy", "food", "grow")),
                ("What is the main purpose of photosynthesis?", ("glucose", "food", "energy", "photosynthesis")),
                ("Answer this MCQ and return the answer letter first: Which gas do plants absorb for photosynthesis? A. Oxygen B. Carbon dioxide C. Nitrogen D. Hydrogen", ("b", "carbon dioxide")),
            ]
            outputs = []
            for prompt, expected_terms in questions:
                status, result = request("http://127.0.0.1:8765/generate", {"prompt": prompt, "max_new_tokens": 64, "temperature": 0}, timeout=180)
                answer = str(result.get("response", "")).strip()
                low = answer.casefold()
                concept = (bool(re.search(r"^\s*(?:answer\s*[:\-]?\s*)?B(?:[.)\s:\-]|$)", answer, re.I)) or "carbon dioxide" in low) if "Answer this MCQ" in prompt else any(term in low for term in expected_terms)
                outputs.append({"prompt": prompt, "http_status": status, "response": answer, "contains_expected_concept": concept, "output_valid": result.get("output_valid")})
                if status != 200 or not answer:
                    raise SystemExit("Model endpoint failed its functional smoke test: " + json.dumps(outputs, ensure_ascii=False))
            report = {"api_health": health, "functional_tests_passed": len(outputs), "semantic_checks_passed": sum(x["contains_expected_concept"] for x in outputs), "semantic_checks_total": len(outputs), "outputs": outputs, "quality_certified": False}
            print(json.dumps(report, ensure_ascii=False))
            # Functional readiness is required to preserve weights. Semantic failures are
            # explicitly reported but do not discard an otherwise valid fine-tuned model.
        finally:
            proc.terminate()
            try: proc.wait(timeout=15)
            except subprocess.TimeoutExpired: proc.kill()

if __name__ == "__main__":
    main()
