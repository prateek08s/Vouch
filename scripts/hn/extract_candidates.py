"""Step 1 of the Hacker News import: find comments that mention a YouTube link.

Downloads the open-index/hacker-news monthly Parquet files (license ODC-BY) one month
at a time, keeps live comments whose text mentions YouTube, and writes them as JSONL.
Only the needed columns are read, so memory stays low. Finished months are skipped,
so the script can be stopped and restarted.

Usage:
  python -I scripts/hn/extract_candidates.py --year 2025 [--months 1-12] [--keep-raw]

Output: .data/hn/candidates/YYYY-MM.jsonl, one object per line:
  {"id": 42562857, "by": "someone", "time": "2025-01-01T00:03:12Z", "parent": 42562001, "text": "<raw HN html>"}

Parsing the links, filtering and importing happen in TypeScript (lib/hn), where they are tested.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request

import pyarrow.parquet as pq

BASE = "https://huggingface.co/datasets/open-index/hacker-news/resolve/main/data"
COMMENT = 2
# Deliberately loose: the TypeScript side decides what is a real video link.
YOUTUBE_HINT = re.compile(r"youtu(?:\.be|be(?:-nocookie)?\.com)", re.IGNORECASE)
COLUMNS = ["id", "type", "by", "time", "text", "parent", "dead", "deleted"]


def parse_months(spec: str) -> list[int]:
    if "-" in spec:
        a, b = spec.split("-", 1)
        months = list(range(int(a), int(b) + 1))
    else:
        months = [int(m) for m in spec.split(",")]
    if not months or any(m < 1 or m > 12 for m in months):
        raise SystemExit(f"bad --months: {spec}")
    return months


def download(url: str, dest: str, attempts: int = 4) -> None:
    tmp = dest + ".part"
    for i in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=120) as res, open(tmp, "wb") as out:
                while chunk := res.read(1 << 20):
                    out.write(chunk)
            os.replace(tmp, dest)
            return
        except Exception as e:  # network errors are retried, then surfaced
            if i == attempts:
                raise
            print(f"  download failed ({e}), retry {i}/{attempts - 1}", file=sys.stderr)
            time.sleep(5 * i)


def extract(parquet_path: str, out_path: str) -> tuple[int, int]:
    f = pq.ParquetFile(parquet_path)
    comments = kept = 0
    tmp = out_path + ".part"
    with open(tmp, "w", encoding="utf-8") as out:
        for i in range(f.num_row_groups):
            for r in f.read_row_group(i, columns=COLUMNS).to_pylist():
                if r["type"] != COMMENT:
                    continue
                comments += 1
                if r["dead"] or r["deleted"] or not r["text"] or not YOUTUBE_HINT.search(r["text"]):
                    continue
                kept += 1
                out.write(json.dumps({
                    "id": r["id"],
                    "by": r["by"],
                    "time": r["time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "parent": r["parent"],
                    "text": r["text"],
                }, ensure_ascii=False) + "\n")
    os.replace(tmp, out_path)
    return comments, kept


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--months", default="1-12")
    ap.add_argument("--data-dir", default=os.path.join(".data", "hn"))
    ap.add_argument("--keep-raw", action="store_true")
    args = ap.parse_args()

    raw_dir = os.path.join(args.data_dir, "raw")
    out_dir = os.path.join(args.data_dir, "candidates")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    total_c = total_k = 0
    for m in parse_months(args.months):
        name = f"{args.year}-{m:02d}"
        out_path = os.path.join(out_dir, f"{name}.jsonl")
        if os.path.exists(out_path):
            print(f"{name}: already extracted, skipping")
            continue
        raw = os.path.join(raw_dir, f"{name}.parquet")
        if not os.path.exists(raw):
            print(f"{name}: downloading")
            download(f"{BASE}/{args.year}/{name}.parquet", raw)
        c, k = extract(raw, out_path)
        total_c += c
        total_k += k
        print(f"{name}: {k} of {c} comments mention YouTube")
        if not args.keep_raw:
            os.remove(raw)
    print(f"done: {total_k} candidates from {total_c} comments")


if __name__ == "__main__":
    main()
