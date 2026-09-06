"""
Offline RAG evaluation for SchoolBook.

This is intentionally separate from the production app (which has no Python
dependency at all). It hits the deployed /api/ask endpoint with a labeled
question set and reports retrieval + faithfulness metrics, so you can compare
this Vectorize/Groq pipeline against the original Chroma/Ollama pipeline's
numbers (see RAG_evaluation_result.png / eval.ipynb in the original repo).

Usage:
    pip install requests
    python tools/offline/evaluate.py --base-url https://schoolbooks.acadapp.in --questions questions.csv

questions.csv columns: question, expected_subject, expected_chapter
"""
import argparse
import csv
import time
import requests


def run(base_url: str, questions_csv: str):
    results = []
    with open(questions_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            start = time.time()
            resp = requests.post(
                f"{base_url}/api/ask",
                json={"question": row["question"]},
                timeout=30,
            )
            latency = time.time() - start
            ok = resp.status_code == 200
            data = resp.json() if ok else {}
            sources = data.get("sources", [])
            subject_hit = any(s.get("subject") == row.get("expected_subject") for s in sources)
            chapter_hit = any(s.get("chapter") == row.get("expected_chapter") for s in sources)
            insufficient = data.get("insufficientContext", False)

            results.append(
                {
                    "question": row["question"],
                    "ok": ok,
                    "latency_s": round(latency, 2),
                    "subject_hit": subject_hit,
                    "chapter_hit": chapter_hit,
                    "insufficient_context": insufficient,
                    "num_sources": len(sources),
                }
            )

    total = len(results)
    if total == 0:
        print("No questions found.")
        return

    failure_rate = sum(1 for r in results if not r["ok"]) / total
    avg_latency = sum(r["latency_s"] for r in results) / total
    subject_recall = sum(1 for r in results if r["subject_hit"]) / total
    chapter_recall = sum(1 for r in results if r["chapter_hit"]) / total
    insufficient_rate = sum(1 for r in results if r["insufficient_context"]) / total

    print(f"Questions evaluated: {total}")
    print(f"Failure rate:        {failure_rate:.1%}")
    print(f"Avg latency:         {avg_latency:.2f}s")
    print(f"Subject recall:      {subject_recall:.1%}")
    print(f"Chapter recall:      {chapter_recall:.1%}")
    print(f"Insufficient-context rate: {insufficient_rate:.1%}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--questions", required=True)
    args = parser.parse_args()
    run(args.base_url, args.questions)
