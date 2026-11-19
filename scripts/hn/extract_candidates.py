"""Step 1 of the Hacker News import: find comments that mention a YouTube link.

Downloads the open-index/hacker-news monthly Parquet files (license ODC-BY) one month
at a time, keeps live comments whose text mentions YouTube, and writes them as JSONL.
Only the needed columns are read, so memory stays low. Finished months are skipped,
so the script can be stopped and restarted.

Usage:
  python -I scripts/hn/extract_candidates.py --year 2025 [--months 1-12] [--keep-raw]
  python -I scripts/hn/extract_candidates.py --month-list 2026-10,2026-11 --refresh --skip-missing

--refresh re-extracts months already done (for months still collecting comments).
--skip-missing skips a month the dataset doesn't publish yet (HTTP 404) instead of failing.

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
import urllib.error
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


class NotPublished(Exception):
    """The dataset has no file for this month (yet)."""


def download(url: str, dest: str, attempts: int = 4) -> None:
    tmp = dest + ".part"
    for i in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=120) as res, open(tmp, "wb") as out:
                while chunk := res.read(1 << 20):
                    out.write(chunk)
            os.replace(tmp, dest)
            return
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotPublished(url) from e
            if i == attempts:
                raise
            print(f"  download failed ({e}), retry {i}/{attempts - 1}", file=sys.stderr)
            time.sleep(5 * i)
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
    ap.add_argument("--year", type=int)
    ap.add_argument("--months", default="1-12")
    ap.add_argument("--month-list", help="YYYY-MM,YYYY-MM,... (instead of --year/--months)")
    ap.add_argument("--data-dir", default=os.path.join(".data", "hn"))
    ap.add_argument("--keep-raw", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--skip-missing", action="store_true")
    args = ap.parse_args()
    if args.month_list:
        names = [m.strip() for m in args.month_list.split(",") if m.strip()]
        if not names or any(not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", m) for m in names):
            raise SystemExit(f"bad --month-list: {args.month_list}")
    elif args.year:
        names = [f"{args.year}-{m:02d}" for m in parse_months(args.months)]
    else:
        raise SystemExit("pass --year YYYY [--months ...] or --month-list YYYY-MM,...")

    raw_dir = os.path.join(args.data_dir, "raw")
    out_dir = os.path.join(args.data_dir, "candidates")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    total_c = total_k = 0
    for name in names:
        out_path = os.path.join(out_dir, f"{name}.jsonl")
        if os.path.exists(out_path) and not args.refresh:
            print(f"{name}: already extracted, skipping")
            continue
        raw = os.path.join(raw_dir, f"{name}.parquet")
        if not os.path.exists(raw) or args.refresh:
            print(f"{name}: downloading")
            try:
                download(f"{BASE}/{name[:4]}/{name}.parquet", raw)
            except NotPublished:
                if not args.skip_missing:
                    raise SystemExit(f"{name}: the dataset has no file for this month yet")
                print(f"{name}: not published yet, skipping")
                continue
        c, k = extract(raw, out_path)
        total_c += c
        total_k += k
        print(f"{name}: {k} of {c} comments mention YouTube")
        if not args.keep_raw:
            os.remove(raw)
    print(f"done: {total_k} candidates from {total_c} comments")


if __name__ == "__main__":
    main()
