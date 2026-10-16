import json, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import prepare_public_dataset as public
import dataset_pipeline as local

def sample_row(qid, question="Which process releases energy?", answer="B"):
    return {"id":qid,"question":question,"answerKey":answer,"choices":{"label":["A","B","C","D"],"text":["Photosynthesis","Cellular respiration","Evaporation","Condensation"]}}

def test_public_conversion_has_grounded_task_variants():
    rows=public.convert(sample_row("q-1"),"ARC-Easy","train")
    assert [r["task"] for r in rows]==["mcq","short_answer","flashcard","revision"]
    assert rows[0]["expected_key"]=="B"
    assert all(r["license"]=="CC-BY-SA-4.0" and r["source_id"] for r in rows)
    assert all(r["response"].strip() for r in rows)
    assert rows[1]["expected_key"]==""

def test_public_split_limit_keeps_variants_and_both_configs(monkeypatch):
    monkeypatch.setattr(public,"load_split",lambda config,split:[sample_row("one"),sample_row("two","What provides energy?","A"),sample_row("three","What stores energy?","D")])
    rows=public.build_rows(["ARC-Easy","ARC-Challenge"],"train",4,42)
    ids={r["source_id"] for r in rows}
    assert len(ids)==4
    assert all(sum(r["source_id"]==sid for r in rows)==4 for sid in ids)
    assert any(s.startswith("ARC-Easy:") for s in ids)
    assert any(s.startswith("ARC-Challenge:") for s in ids)

def test_source_transformations_do_not_invent_mcq_or_false_facts():
    src={"source_id":"s1","subject":"Science","grade":10,"license":"user-provided","source_url":"","text":"Ohm's law is defined as the relationship between current and potential difference. The equation is V = IR."}
    rows=list(local.make_examples(src))
    tasks={r["task"] for r in rows}
    assert {"notes","summary","short_answer","long_answer","flashcard","revision","definition","fill_blank","formula"} <= tasks
    assert "mcq" not in tasks and "true_false" not in tasks
    assert any("V = IR" in r["response"] for r in rows if r["task"]=="formula")
    valid,errors=local.validate_rows(rows)
    assert not errors
    assert len(valid)==len(rows)

def test_validation_rejects_missing_provenance():
    valid,errors=local.validate_rows([{"instruction":"Explain a concept","response":"A concept explanation."}])
    assert not valid and errors
