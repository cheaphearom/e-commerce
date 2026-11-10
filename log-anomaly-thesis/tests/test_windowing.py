"""Windowing, labelling, split and leakage tests on small synthetic data."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features import fit_features
from src.parse import keyword_regex, mask, split_line
from src.windowing import Samples, build_bgl, chrono_split

CFG_SPLIT = {"train": 0.6, "val": 0.2, "test": 0.2}


def synthetic_lines(n: int = 3000, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    ts = np.sort(rng.integers(1_000_000, 1_000_000 + 20_000, size=n))
    return pd.DataFrame(
        {
            "ts": ts,
            "template_id": rng.integers(1, 15, size=n).astype(np.int32),
            "keyword": rng.random(n) < 0.1,
            "label": (rng.random(n) < 0.02).astype(np.int8),
        }
    )


def brute_force(lines: pd.DataFrame, start: int, window: int) -> tuple[int, int, int, dict]:
    w = lines[(lines.ts >= start) & (lines.ts < start + window)]
    return len(w), int(w.label.max() if len(w) else 0), int(w.keyword.sum()), w.template_id.value_counts().to_dict()


@pytest.mark.parametrize("window,step", [(60, 10), (300, 10), (10, 10)])
def test_bgl_windows_match_brute_force(window: int, step: int) -> None:
    lines = synthetic_lines()
    counts, meta = build_bgl(lines, window, step)
    assert (meta.n_lines > 0).all()
    rng = np.random.default_rng(1)
    for i in rng.choice(len(meta), 50, replace=False):
        n, lab, kw, tpl = brute_force(lines, int(meta.start[i]), window)
        assert meta.n_lines[i] == n
        assert meta.label[i] == lab, "window is anomalous iff it contains >=1 anomalous line"
        assert meta.n_kw[i] == kw
        row = counts[i].toarray().ravel()
        assert {k: int(v) for k, v in enumerate(row) if v} == tpl
        assert meta.last_ts[i] == lines[(lines.ts >= meta.start[i]) & (lines.ts < meta.end[i])].ts.max()


def test_every_nonempty_window_present() -> None:
    lines = synthetic_lines(500)
    _, meta = build_bgl(lines, 60, 10)
    t0 = lines.ts.min() // 10 * 10
    expected = [s for s in range(t0, lines.ts.max() + 1, 10) if ((lines.ts >= s) & (lines.ts < s + 60)).any()]
    assert sorted(meta.start.tolist()) == expected


def test_split_is_chronological_and_leak_free() -> None:
    lines = synthetic_lines()
    counts, meta = build_bgl(lines, 60, 10)
    split, b = chrono_split(meta.start.to_numpy(), meta.last_ts.to_numpy(), CFG_SPLIT)
    meta["split"] = split
    tr, va, te = (meta[meta.split == s] for s in ("train", "val", "test"))
    # no test-period (or validation-period) timestamps in training samples
    assert tr.last_ts.max() < b["t_val"] <= va.start.min()
    assert va.last_ts.max() < b["t_test"] <= te.start.min()
    assert tr.start.max() < va.start.min() < te.start.min()
    assert abs(len(tr) / len(meta) - 0.6) < 0.05


def test_feature_vocab_uses_training_only() -> None:
    lines = synthetic_lines()
    # template 99 appears only at the very end -> test period only
    lines.loc[lines.index[-5:], "template_id"] = 99
    counts, meta = build_bgl(lines, 60, 10)
    meta["n_distinct"] = np.diff(counts.indptr)
    meta["split"], b = chrono_split(meta.start.to_numpy(), meta.last_ts.to_numpy(), CFG_SPLIT)
    keep = (meta.split != "drop").to_numpy()
    s = Samples("t", counts[keep], meta[keep].reset_index(drop=True), b)
    fs = fit_features(s)
    assert 99 not in fs.vocab
    X = fs.transform(s).toarray()
    unknown = X[:, fs.names.index("unknown")]
    assert unknown[s.mask("train")].sum() == 0
    assert unknown[s.mask("test")].sum() > 0
    # TF-IDF variant has the same shape
    assert fit_features(s, tfidf=True).transform(s).shape == X.shape


def test_masking_and_line_split() -> None:
    m = mask("Receiving block blk_-160899 src: /10.250.19.102:54106 dest: /10.250.19.102:50010 size 67108864 at 0x1f3a")
    assert m == "Receiving block <BLK> src: <IP> dest: <IP> size <NUM> at <HEX>"
    text, content, label = split_line(
        "BGL", "APPREAD 1117869872 2005.06.04 R04-M1-N4-I:J18-U11 2005-06-04-00.24.32.432192 R04-M1-N4-I:J18-U11 RAS APP FATAL ciod: failed"
    )
    assert label == "APPREAD" and not text.startswith("APPREAD") and content == "ciod: failed"
    assert keyword_regex(["fail", "ERROR"]).search(text)


@pytest.mark.parametrize("name", ["HDFS", "BGL_w60", "BGL_w300"])
def test_real_data_no_test_timestamps_in_training(name: str) -> None:
    """On the real processed data: every training/validation line precedes the next period."""
    import json

    from src.utils import load_config, processed_dir

    d = processed_dir(load_config())
    if not (d / f"{name}_meta.parquet").exists():
        pytest.skip(f"{name} not built yet")
    meta = pd.read_parquet(d / f"{name}_meta.parquet")
    b = json.loads((d / f"{name}_bounds.json").read_text())
    assert meta.loc[meta.split == "train", "last_ts"].max() < b["t_val"]
    assert meta.loc[meta.split == "val", "last_ts"].max() < b["t_test"]
    assert meta.loc[meta.split == "test", "start"].min() >= b["t_test"]
