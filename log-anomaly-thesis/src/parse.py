"""Parse raw HDFS / BGL logs into structured Parquet with Drain3.

Usage::

    python -m src.parse --dataset HDFS
    python -m src.parse --dataset BGL [--sample 200000] [--force]

Output (``data/processed/``):
  * ``<DS>_lines.parquet``     one row per (line, block): line_id, ts, template_id, keyword, label/block_id
  * ``<DS>_templates.parquet`` template_id, template, n_lines
  * ``<DS>_parse_stats.json``  lines, templates, parse time

The template text lives in its own table (joined on ``template_id``) so the
line table does not repeat millions of strings.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from drain3.drain import Drain
from tqdm import tqdm

from src.utils import DATASETS, get_logger, load_config, p, processed_dir, sample_suffix, timer

log = get_logger("parse")

# Masking is applied to the message content before Drain3 sees it.
# Order matters: block IDs and IPs first, so their digits are not masked as numbers.
MASKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"blk_-?\d+"), "<BLK>"),
    (re.compile(r"/?\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b"), "<IP>"),
    (re.compile(r"\b0[xX][0-9a-fA-F]+\b"), "<HEX>"),
    (re.compile(r"\b(?=[0-9a-fA-F]*\d)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{8,}\b"), "<HEX>"),
    (re.compile(r"\b\d+(?:\.\d+)?\b"), "<NUM>"),
]
BLOCK_RE = re.compile(r"blk_(-?\d+)")


def mask(text: str) -> str:
    """Replace block IDs, IPs, hex IDs and numbers with placeholder tokens."""
    for pattern, token in MASKS:
        text = pattern.sub(token, text)
    return text


def keyword_regex(keywords: list[str]) -> re.Pattern[str]:
    """Case-sensitive substring regex for the keyword list."""
    return re.compile("|".join(re.escape(k) for k in sorted(keywords, key=len, reverse=True)))


def split_line(dataset: str, line: str) -> tuple[str, str, str] | None:
    """Split a raw line into (header_without_label, content, label_field).

    HDFS: ``date time pid level component: content`` (no label field).
    BGL:  ``label ts date node time node type component level content``;
    the label field (``-`` = normal) is removed from the text used by rules.
    """
    if dataset == "HDFS":
        parts = line.split(" ", 5)
        if len(parts) < 6:
            return None
        # parts: date, time, pid, level, "component:", content
        return line, parts[5], ""
    parts = line.split(" ", 9)
    if len(parts) < 2:
        return None
    label = parts[0]
    text = line[len(label) + 1 :]
    content = parts[9] if len(parts) > 9 else ""
    return text, content, label


class Parser:
    """Drain3 wrapper with a cache keyed on the masked content.

    Identical masked lines always land in the same cluster, so the cache only
    skips redundant tree look-ups; it does not change the result.
    """

    def __init__(self, sim_th: float, depth: int) -> None:
        self.drain = Drain(sim_th=sim_th, depth=depth)
        self.cache: dict[str, int] = {}
        self.counts: dict[int, int] = {}

    def __call__(self, content: str) -> int:
        masked = mask(content)
        cid = self.cache.get(masked)
        if cid is None:
            cluster, _ = self.drain.add_log_message(masked)
            cid = cluster.cluster_id
            self.cache[masked] = cid
        self.counts[cid] = self.counts.get(cid, 0) + 1
        return cid

    def templates(self) -> pd.DataFrame:
        rows = [(c.cluster_id, c.get_template(), self.counts.get(c.cluster_id, 0)) for c in self.drain.clusters]
        return pd.DataFrame(rows, columns=["template_id", "template", "n_lines"]).sort_values("template_id")


def read_chunks(path: Path, chunk: int, limit: int | None) -> Iterator[list[str]]:
    """Yield lists of raw lines (decoded leniently) in file order."""
    buf: list[str] = []
    n = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            buf.append(line.rstrip("\n"))
            n += 1
            if len(buf) >= chunk:
                yield buf
                buf = []
            if limit and n >= limit:
                break
    if buf:
        yield buf


def count_lines(path: Path) -> int:
    with open(path, "rb") as fh:
        return sum(buf.count(b"\n") for buf in iter(lambda: fh.read(1 << 24), b""))


def parse_dataset(dataset: str, cfg: dict[str, Any], sample: int | None = None, force: bool = False) -> dict:
    """Parse one dataset, write Parquet files and return parse statistics."""
    out = processed_dir(cfg)
    sfx = sample_suffix(sample)
    lines_path = out / f"{dataset}{sfx}_lines.parquet"
    tpl_path = out / f"{dataset}{sfx}_templates.parquet"
    stats_path = out / f"{dataset}{sfx}_parse_stats.json"
    if lines_path.exists() and tpl_path.exists() and stats_path.exists() and not force:
        log.info("%s already parsed (use --force to redo): %s", dataset, lines_path)
        return json.loads(stats_path.read_text())

    src = p(cfg["datasets"][dataset]["log_file"])
    if not src.exists():
        raise SystemExit(f"{src} not found; run `python -m src.download` first")
    pc = cfg["parsing"]
    parser = Parser(pc["drain_sim_th"], pc["drain_depth"])
    kw = keyword_regex(cfg["keywords"])
    total = sample or count_lines(src)

    writer: pq.ParquetWriter | None = None
    n_lines = n_bad = 0
    with timer() as t:
        bar = tqdm(total=total, unit="line", desc=f"parse {dataset}")
        for chunk in read_chunks(src, pc["chunk_lines"], sample):
            cols: dict[str, list] = {"line_id": [], "template_id": [], "keyword": [], "raw_ts": []}
            if dataset == "HDFS":
                cols["block_id"] = []
            else:
                cols["label"] = []
            for line in chunk:
                lid = n_lines
                n_lines += 1
                parts = split_line(dataset, line)
                if parts is None:
                    n_bad += 1
                    continue
                text, content, label = parts
                tid = parser(content)
                has_kw = kw.search(text) is not None
                if dataset == "HDFS":
                    raw_ts = text[:13]  # "yymmdd HHMMSS"
                    # One row per block mentioned in the line (almost always exactly one).
                    for b in set(BLOCK_RE.findall(content)) or {None}:
                        cols["line_id"].append(lid)
                        cols["template_id"].append(tid)
                        cols["keyword"].append(has_kw)
                        cols["raw_ts"].append(raw_ts)
                        cols["block_id"].append(f"blk_{b}" if b is not None else None)
                else:
                    cols["line_id"].append(lid)
                    cols["template_id"].append(tid)
                    cols["keyword"].append(has_kw)
                    cols["raw_ts"].append(text.split(" ", 1)[0])
                    cols["label"].append(0 if label == "-" else 1)
            bar.update(len(chunk))

            df = pd.DataFrame(cols)
            if dataset == "HDFS":
                ts = pd.to_datetime(df["raw_ts"], format="%y%m%d %H%M%S", errors="coerce")
                df["ts"] = (ts - pd.Timestamp("1970-01-01")) // pd.Timedelta("1s")
            else:
                df["ts"] = pd.to_numeric(df["raw_ts"], errors="coerce")
                df["label"] = df["label"].astype("int8")
            bad_ts = df["ts"].isna()
            if bad_ts.any():
                n_bad += int(bad_ts.sum())
                df = df[~bad_ts]
            df = df.drop(columns="raw_ts")
            df["ts"] = df["ts"].astype("int64")
            df["template_id"] = df["template_id"].astype("int32")
            table = pa.Table.from_pandas(df, preserve_index=False)
            if writer is None:
                writer = pq.ParquetWriter(lines_path, table.schema, compression="zstd")
            writer.write_table(table)
        bar.close()
    if writer is not None:
        writer.close()

    templates = parser.templates()
    templates.to_parquet(tpl_path, index=False)
    stats = {
        "dataset": dataset,
        "sample": sample,
        "lines": n_lines,
        "skipped_lines": n_bad,
        "templates": int(len(templates)),
        "parse_time_s": round(t["s"], 1),
        "lines_per_s": round(n_lines / t["s"]),
    }
    stats_path.write_text(json.dumps(stats, indent=2))
    log.info("%s: %d lines (%d skipped), %d templates, %.1f s", dataset, n_lines, n_bad, len(templates), t["s"])
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", choices=DATASETS, required=True)
    ap.add_argument("--sample", type=int, default=None, help="BGL only: parse the first N lines")
    ap.add_argument("--force", action="store_true", help="re-parse even if output exists")
    args = ap.parse_args()
    if args.sample and args.dataset != "BGL":
        raise SystemExit("--sample is only supported for BGL")
    parse_dataset(args.dataset, load_config(), args.sample, args.force)


if __name__ == "__main__":
    main()
