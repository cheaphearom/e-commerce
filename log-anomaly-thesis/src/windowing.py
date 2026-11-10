"""Group parsed lines into samples and split them chronologically.

* HDFS: one sample per block ID; labels from ``anomaly_label.csv``.
* BGL: time-based sliding windows (default 60 s window, 10 s step). A window
  is anomalous if it contains at least one anomalous line. Empty windows are
  dropped (there is nothing to classify in them).

Chronological 60/20/20 split by sample start time. Samples that cross a split
boundary (a long-lived HDFS block, or a BGL window overlapping the next period)
are dropped so that no training sample contains a log line from the validation
or test period.

Usage::

    python -m src.windowing --dataset HDFS
    python -m src.windowing --dataset BGL [--window 300] [--sample N]

Output: ``data/processed/<name>_counts.npz`` (sparse sample x template counts)
and ``<name>_meta.parquet`` (start, end, label, n_lines, n_kw, n_distinct, split).
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import scipy.sparse as sp

from src.utils import DATASETS, get_logger, load_config, p, processed_dir, sample_suffix, timer

log = get_logger("windowing")
SPLITS = ("train", "val", "test")


@dataclass
class Samples:
    """Sample-level data shared by rules, features and models."""

    name: str
    counts: sp.csr_matrix   # n_samples x n_templates (column = template_id)
    meta: pd.DataFrame      # one row per sample, same order as ``counts``
    boundaries: dict        # {"t_val": ..., "t_test": ..., "t_end": ...}

    def mask(self, split: str) -> np.ndarray:
        return (self.meta["split"] == split).to_numpy()

    def y(self, split: str) -> np.ndarray:
        return self.meta.loc[self.mask(split), "label"].to_numpy()


def sample_name(dataset: str, window_s: int | None, sample: int | None) -> str:
    """File stem for a sample set, e.g. ``BGL_w60`` or ``HDFS``."""
    return f"{dataset}{sample_suffix(sample)}" + (f"_w{window_s}" if dataset == "BGL" else "")


def load_lines(dataset: str, cfg: dict[str, Any], sample: int | None = None) -> pd.DataFrame:
    path = processed_dir(cfg) / f"{dataset}{sample_suffix(sample)}_lines.parquet"
    if not path.exists():
        raise SystemExit(f"{path} not found; run `python -m src.parse --dataset {dataset}` first")
    return pd.read_parquet(path)


def chrono_split(start: np.ndarray, end_ts: np.ndarray, ratios: dict[str, float]) -> tuple[np.ndarray, dict]:
    """Assign train/val/test by start time and drop samples crossing a boundary.

    ``end_ts`` is the timestamp of the last log line in the sample. Returns the
    split label per sample (``"drop"`` for crossing samples) and the boundaries.
    """
    order = np.sort(start, kind="stable")
    n = len(order)
    t_val = order[int(n * ratios["train"])]
    t_test = order[int(n * (ratios["train"] + ratios["val"]))]
    split = np.where(start < t_val, "train", np.where(start < t_test, "val", "test")).astype(object)
    crossing = ((split == "train") & (end_ts >= t_val)) | ((split == "val") & (end_ts >= t_test))
    split[crossing] = "drop"
    return split, {"t_val": float(t_val), "t_test": float(t_test)}


def build_hdfs(lines: pd.DataFrame, cfg: dict[str, Any]) -> tuple[sp.csr_matrix, pd.DataFrame]:
    """One sample per block ID."""
    lines = lines.dropna(subset=["block_id"])
    codes, blocks = pd.factorize(lines["block_id"], sort=False)
    n_t = int(lines["template_id"].max()) + 1
    counts = sp.coo_matrix(
        (np.ones(len(lines), dtype=np.float32), (codes, lines["template_id"].to_numpy())),
        shape=(len(blocks), n_t),
    ).tocsr()
    counts.sum_duplicates()
    g = lines.assign(code=codes).groupby("code")
    meta = pd.DataFrame(
        {
            "sample_id": np.asarray(blocks, dtype=object),
            "start": g["ts"].min().to_numpy(),
            "last_ts": g["ts"].max().to_numpy(),
            "n_lines": g.size().to_numpy(),
            "n_kw": g["keyword"].sum().to_numpy(),
        }
    )
    meta["end"] = meta["last_ts"] + 1
    lab = pd.read_csv(p(cfg["datasets"]["HDFS"]["label_file"]))
    lab_map = dict(zip(lab["BlockId"], (lab["Label"] == "Anomaly").astype(int)))
    meta["label"] = meta["sample_id"].map(lab_map)
    missing = meta["label"].isna().sum()
    if missing:
        log.warning("HDFS: %d blocks have no label and are dropped", missing)
        keep = meta["label"].notna().to_numpy()
        meta, counts = meta[keep].reset_index(drop=True), counts[keep]
    meta["label"] = meta["label"].astype(int)
    return counts, meta


def build_bgl(lines: pd.DataFrame, window_s: int, step_s: int) -> tuple[sp.csr_matrix, pd.DataFrame]:
    """Sliding time windows ``[start, start + window_s)`` every ``step_s`` seconds.

    Lines are first counted per ``step_s`` bin; a window is then the sum of
    ``window_s / step_s`` consecutive bins (done as one sparse matrix product).
    """
    if window_s % step_s:
        raise ValueError("window size must be a multiple of the step")
    m = window_s // step_s
    ts = lines["ts"].to_numpy()
    t0 = (ts.min() // step_s) * step_s
    bins = ((ts - t0) // step_s).astype(np.int64)
    n_bins = int(bins.max()) + 1
    n_t = int(lines["template_id"].max()) + 1
    ones = np.ones(len(lines), dtype=np.float32)
    B = sp.coo_matrix((ones, (bins, lines["template_id"].to_numpy())), shape=(n_bins, n_t)).tocsr()
    per_bin = lambda v: np.bincount(bins, weights=v, minlength=n_bins)  # noqa: E731
    bin_lines = per_bin(ones)
    bin_anom = per_bin(lines["label"].to_numpy().astype(np.float64))
    bin_kw = per_bin(lines["keyword"].to_numpy().astype(np.float64))
    kernel = np.ones(m)
    # window k covers bins k .. k+m-1; only windows that start inside the data
    win_lines = np.convolve(bin_lines, kernel)[m - 1 :][:n_bins]
    keep = np.flatnonzero(win_lines > 0)
    rows = np.repeat(np.arange(len(keep)), m)
    cols = (keep[:, None] + np.arange(m)[None, :]).ravel()
    ok = cols < n_bins
    A = sp.csr_matrix((np.ones(ok.sum(), dtype=np.float32), (rows[ok], cols[ok])), shape=(len(keep), n_bins))
    counts = (A @ B).tocsr()
    # last line timestamp in each window (for the boundary check)
    last_in_bin = pd.Series(ts).groupby(bins).max().reindex(range(n_bins)).to_numpy()
    last_ts = np.full(len(keep), -np.inf)
    for j in range(m):
        idx = np.minimum(keep + j, n_bins - 1)
        v = np.where(keep + j < n_bins, last_in_bin[idx], np.nan)
        last_ts = np.fmax(last_ts, v)
    start = t0 + keep * step_s
    meta = pd.DataFrame(
        {
            "sample_id": [f"w{s}" for s in start],
            "start": start,
            "end": start + window_s,
            "last_ts": last_ts,
            "n_lines": (A @ bin_lines).astype(int),
            "n_kw": (A @ bin_kw).astype(int),
            "label": ((A @ bin_anom) > 0).astype(int),
        }
    )
    return counts, meta


def build_samples(
    dataset: str,
    cfg: dict[str, Any],
    window_s: int | None = None,
    sample: int | None = None,
    force: bool = False,
) -> Samples:
    """Build (or load cached) samples for a dataset / window setting."""
    if dataset == "BGL":
        window_s = window_s or cfg["windowing"]["BGL"]["window_s"]
    name = sample_name(dataset, window_s, sample)
    out = processed_dir(cfg)
    cpath, mpath, bpath = out / f"{name}_counts.npz", out / f"{name}_meta.parquet", out / f"{name}_bounds.json"
    if cpath.exists() and mpath.exists() and bpath.exists() and not force:
        return Samples(name, sp.load_npz(cpath).tocsr(), pd.read_parquet(mpath), json.loads(bpath.read_text()))

    with timer() as t:
        lines = load_lines(dataset, cfg, sample)
        if dataset == "HDFS":
            counts, meta = build_hdfs(lines, cfg)
        else:
            counts, meta = build_bgl(lines, window_s, cfg["windowing"]["BGL"]["step_s"])
        meta["n_distinct"] = np.diff(counts.indptr)
        meta["split"], bounds = chrono_split(meta["start"].to_numpy(), meta["last_ts"].to_numpy(), cfg["split"])
        bounds["t_start"] = float(lines["ts"].min())
        bounds["t_end"] = float(lines["ts"].max())
        n_drop = int((meta["split"] == "drop").sum())
        if not cfg["split"].get("drop_crossing", True):
            # keep crossing samples in the split given by their start time
            s, _ = chrono_split(meta["start"].to_numpy(), np.full(len(meta), -np.inf), cfg["split"])
            meta["split"] = s
            n_drop = 0
        keep = (meta["split"] != "drop").to_numpy()
        meta, counts = meta[keep].reset_index(drop=True), counts[keep]
        bounds["dropped_crossing"] = n_drop
    sp.save_npz(cpath, counts)
    meta.to_parquet(mpath, index=False)
    bpath.write_text(json.dumps(bounds, indent=2))
    log.info("%s: %d samples (%d crossing a split boundary dropped) in %.1f s", name, len(meta), n_drop, t["s"])
    for s in SPLITS:
        sub = meta[meta["split"] == s]
        log.info("  %-5s n=%-8d anomalous=%.2f%%", s, len(sub), 100 * sub["label"].mean())
    return Samples(name, counts, meta, bounds)


def dataset_stats(cfg: dict[str, Any], sample: int | None = None) -> pd.DataFrame:
    """Checkpoint-1 table: lines, templates, parse time, samples, % anomalous per split."""
    rows = []
    w = cfg["windowing"]["BGL"]
    settings = [("HDFS", None), ("BGL", w["window_s"]), ("BGL", w["sensitivity_window_s"])]
    for ds, win in settings:
        if sample and ds == "HDFS":
            continue
        ps = json.loads((processed_dir(cfg) / f"{ds}{sample_suffix(sample)}_parse_stats.json").read_text())
        s = build_samples(ds, cfg, win, sample)
        row = {
            "dataset": s.name,
            "lines": ps["lines"],
            "templates": ps["templates"],
            "parse_time_s": ps["parse_time_s"],
            "samples": len(s.meta),
            "dropped_crossing": s.boundaries["dropped_crossing"],
            "period_start": pd.to_datetime(s.boundaries["t_start"], unit="s"),
            "val_start": pd.to_datetime(s.boundaries["t_val"], unit="s"),
            "test_start": pd.to_datetime(s.boundaries["t_test"], unit="s"),
            "period_end": pd.to_datetime(s.boundaries["t_end"], unit="s"),
        }
        for sp_ in SPLITS:
            sub = s.meta[s.meta["split"] == sp_]
            row[f"{sp_}_n"] = len(sub)
            row[f"{sp_}_anom"] = int(sub["label"].sum())
            row[f"{sp_}_anom_pct"] = round(100 * sub["label"].mean(), 2)
        rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", choices=DATASETS)
    ap.add_argument("--summary", action="store_true", help="build all settings and write the dataset statistics table")
    ap.add_argument("--window", type=int, default=None, help="BGL window size in seconds")
    ap.add_argument("--sample", type=int, default=None, help="BGL only: use the --sample parse")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    cfg = load_config()
    if args.summary:
        from src.utils import save_table

        df = dataset_stats(cfg, args.sample)
        save_table(df, f"dataset_stats{sample_suffix(args.sample)}", cfg, floatfmt=".2f")
        print(df.T.to_string())
        return
    if not args.dataset:
        ap.error("--dataset is required unless --summary is given")
    build_samples(args.dataset, cfg, args.window, args.sample, args.force)


if __name__ == "__main__":
    main()
