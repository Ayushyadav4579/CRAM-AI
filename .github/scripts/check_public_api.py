import json, os, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = os.getenv("CRAM_API_URL", "https://cram-ai-api.onrender.com").rstrip("/")
OUT = Path("public-api-check.json")
report = {"base_url": BASE, "checked_at": datetime.now(timezone.utc).isoformat(), "checks": []}

def call(path, payload=None, timeout=180):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8", "replace")
            try: parsed = json.loads(body)
            except ValueError: parsed = {"raw": body[:2000]}
            return res.status, parsed
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try: parsed = json.loads(body)
        except ValueError: parsed = {"raw": body[:2000]}
        return e.code, parsed
    except Exception as e:
        return 0, {"error": type(e).__name__ + ": " + str(e)}

# Retry cold-start/network conditions with bounded backoff.
health_status, health = 0, {}
for delay in [0, 5, 10, 15, 20]:
    if delay: time.sleep(delay)
    health_status, health = call("/health", timeout=45)
    if health_status == 200: break
report["checks"].append({"name":"health", "status":health_status, "body":health})
info_status, info = call("/model-info", timeout=45)
report["checks"].append({"name":"model-info", "status":info_status, "body":info})

gen_status, gen = call("/generate", {"prompt":"What is photosynthesis? Answer in two clear sentences.", "max_new_tokens":64, "temperature":0}, timeout=180)
report["checks"].append({"name":"generate", "status":gen_status, "body":gen})

invalid_status, invalid = call("/generate", {"prompt":""}, timeout=30)
report["checks"].append({"name":"invalid-input", "status":invalid_status, "body":invalid})

# Test model identity/readiness and ensure invalid requests are rejected.
health_body = health if isinstance(health, dict) else {}
gen_body = gen if isinstance(gen, dict) else {}
ready = health_status == 200 and health_body.get("model_loaded") is True
generation_ok = gen_status == 200 and gen_body.get("model_loaded") is True and bool(str(gen_body.get("response","")).strip()) and gen_body.get("output_valid") is True
invalid_rejected = invalid_status in (400, 422)
report["summary"] = {"model_loaded":ready, "generation_endpoint_works":generation_ok, "invalid_input_rejected":invalid_rejected}
OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False))
if not ready or not generation_ok or not invalid_rejected:
    raise SystemExit("Public API acceptance smoke test failed; see public-api-check.json artifact.")
