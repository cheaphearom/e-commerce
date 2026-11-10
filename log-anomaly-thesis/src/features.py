"""Turn sample x template counts into model features.

Feature vector per sample:
  * event counts, one column per template seen in the **training** split
    (optionally TF-IDF weighted, IDF learned on training samples only)
  * ``unknown``: count of lines whose template never occurs in training
  * ``n_lines``, ``n_distinct`` (distinct templates), ``kw_ratio`` (keyword lines / lines)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp

from src.windowing import Samples


@dataclass
class FeatureSpace:
    vocab: np.ndarray          # template ids that get their own column
    idf: np.ndarray | None     # per-vocab IDF weights (None = raw counts)
    names: list[str]

    def transform(self, samples: Samples, mask: np.ndarray | None = None) -> sp.csr_matrix:
        counts = samples.counts if mask is None else samples.counts[mask]
        meta = samples.meta if mask is None else samples.meta[mask]
        known = counts[:, self.vocab]
        unknown = np.asarray(counts.sum(axis=1)).ravel() - np.asarray(known.sum(axis=1)).ravel()
        if self.idf is not None:
            known = known @ sp.diags(self.idf.astype(np.float32))
        n_lines = meta["n_lines"].to_numpy(dtype=np.float32)
        extra = np.column_stack(
            [unknown, n_lines, meta["n_distinct"].to_numpy(dtype=np.float32), meta["n_kw"].to_numpy() / np.maximum(n_lines, 1)]
        ).astype(np.float32)
        return sp.hstack([known, sp.csr_matrix(extra)], format="csr", dtype=np.float32)


def fit_features(samples: Samples, tfidf: bool = False) -> FeatureSpace:
    """Learn the vocabulary (and IDF) from the training split only."""
    train = samples.counts[samples.mask("train")]
    df = np.asarray((train > 0).sum(axis=0)).ravel()
    vocab = np.flatnonzero(df > 0)
    idf = None
    if tfidf:
        n = train.shape[0]
        idf = np.log((1 + n) / (1 + df[vocab])) + 1.0  # sklearn's smooth IDF
    names = [f"T{t}" for t in vocab] + ["unknown", "n_lines", "n_distinct", "kw_ratio"]
    return FeatureSpace(vocab, idf, names)
