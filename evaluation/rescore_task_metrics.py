"""Re-score saved generations with task-aware answer extraction and format metrics.

This does not rerun the model or change the held-out examples. It corrects the
comparison target for flashcard JSON and revision Q&A, and separates format
validity from answer correctness.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path


def norm(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def token_f1(expected, predicted):
    left, right = norm(expected).split(), norm(predicted).split()
    if not left or not right:
        return 0.0
    overlap = sum((Counter(left) & Counter(right)).values())
    if not overlap:
        return 0.0
    precision, recall = overlap / len(right), overlap / len(left)
    return 2 * precision * recall / (precision + recall)


def strip_leading_key(text):
    return re.sub(
        r"^\s*(?:(?:answer|correct\s+option|option)\s*[:-]?\s*)?"
        r"[A-D](?:\s*[.)\-:]|\s)+",
        "",
        str(text or ""),
        flags=re.I,
    ).strip()


def extract(task, sample):
    raw = str(sample.get("predicted", "") or "").strip()
    if task == "mcq":
        key = sample.get("predicted_key")
        return bool(key), strip_leading_key(raw), key == sample.get("expected_key")
    if task == "short_answer":
        return bool(raw), strip_leading_key(raw), None
    if task == "flashcard":
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            obj = None
        valid = (
            isinstance(obj, dict)
            and isinstance(obj.get("front"), str)
            and isinstance(obj.get("back"), str)
            and bool(obj["front"].strip())
            and bool(obj["back"].strip())
            and norm(obj["front"]) != norm(obj["back"])
        )
        return bool(valid), strip_leading_key(obj["back"]) if valid else "", None
    if task == "revision":
        valid = bool(re.search(r"^\s*Question\s*:", raw, re.I | re.M)) and bool(
            re.search(r"^\s*Answer\s*:", raw, re.I | re.M)
        )
        match = re.search(r"^\s*Answer\s*:\s*(.*)$", raw, re.I | re.M)
        answer = strip_leading_key(match.group(1)) if match else ""
        return valid, answer, None
    return bool(raw), raw, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="model-artifacts/evaluation-smollm.json")
    parser.add_argument("--output", default="model-artifacts/evaluation-smollm-task-aware.json")
    args = parser.parse_args()
    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    tasks = {}
    for sample in source.get("samples", []):
        task = sample.get("task", "unknown")
        result = tasks.setdefault(task, {
            "examples": 0, "format_valid": 0, "answer_exact": 0,
            "token_f1_sum": 0.0, "key_correct": 0, "joint_correct": 0,
        })
        valid, predicted_answer, key_correct = extract(task, sample)
        expected = str(sample.get("expected_answer", "") or "")
        exact = bool(expected) and norm(expected) == norm(predicted_answer)
        result["examples"] += 1
        result["format_valid"] += int(valid)
        result["answer_exact"] += int(exact)
        result["token_f1_sum"] += token_f1(expected, predicted_answer)
        if task == "mcq":
            result["key_correct"] += int(bool(key_correct))
            result["joint_correct"] += int(bool(key_correct) and exact)

    for task, result in tasks.items():
        n = max(1, result["examples"])
        result["format_validity"] = round(result["format_valid"] / n, 4)
        result["answer_exact_match"] = round(result["answer_exact"] / n, 4)
        result["mean_answer_token_f1"] = round(result["token_f1_sum"] / n, 4)
        if task == "mcq":
            result["key_accuracy"] = round(result["key_correct"] / n, 4)
            result["joint_key_and_answer_exact_match"] = round(result["joint_correct"] / n, 4)
        for key in ("format_valid", "answer_exact", "token_f1_sum", "key_correct", "joint_correct"):
            result.pop(key, None)

    report = {
        "report_type": "task-aware-rescore-of-saved-generations",
        "base_model": source.get("base_model"),
        "held_out_examples": source.get("evaluated_examples", len(source.get("samples", []))),
        "mcq_questions": source.get("mcq_questions_scored"),
        "scoring_note": (
            "Same held-out generations and same test set as the source report. MCQ success requires "
            "both expected answer key and exact normalized answer text. Short answers strip a leading "
            "option key; flashcards score the JSON back field; revision scores the Answer line. "
            "Format validity is reported separately from factual correctness."
        ),
        "tasks": tasks,
        "conclusion": (
            "Not production-ready for factual study answers; the measured answer accuracy is far "
            "below the near-perfect target."
        ),
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "tasks"} | {"tasks": report["tasks"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
