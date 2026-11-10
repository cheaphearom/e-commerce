"""Shared helpers: config loading, logging, seeding, timing and table output."""
from __future__ import annotations

import logging
import random
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
DATASETS = ("HDFS", "BGL")


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load ``config.yaml`` (project root by default)."""
    path = Path(path) if path else ROOT / "config.yaml"
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def p(rel: str | Path) -> Path:
    """Resolve a path relative to the project root."""
    rel = Path(rel)
    return rel if rel.is_absolute() else ROOT / rel


def get_logger(name: str) -> logging.Logger:
    """Return a logger that prints timestamped messages to stderr."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    return logging.getLogger(name)


def set_seed(seed: int) -> None:
    """Seed Python and NumPy RNGs."""
    random.seed(seed)
    np.random.seed(seed)


@contextmanager
def timer() -> Iterator[dict[str, float]]:
    """Context manager that stores elapsed wall time (s) in ``result['s']``."""
    result: dict[str, float] = {}
    t0 = time.perf_counter()
    try:
        yield result
    finally:
        result["s"] = time.perf_counter() - t0


def processed_dir(cfg: dict[str, Any]) -> Path:
    d = p(cfg["paths"]["processed"])
    d.mkdir(parents=True, exist_ok=True)
    return d


def tables_dir(cfg: dict[str, Any]) -> Path:
    d = p(cfg["paths"]["results"]) / "tables"
    d.mkdir(parents=True, exist_ok=True)
    return d


def figures_dir(cfg: dict[str, Any]) -> Path:
    d = p(cfg["paths"]["results"]) / "figures"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_table(df: pd.DataFrame, name: str, cfg: dict[str, Any], floatfmt: str = ".4f") -> Path:
    """Write ``df`` as ``results/tables/<name>.csv`` and ``.md``."""
    d = tables_dir(cfg)
    csv_path = d / f"{name}.csv"
    df.to_csv(csv_path, index=False)
    (d / f"{name}.md").write_text(df.to_markdown(index=False, floatfmt=floatfmt) + "\n", encoding="utf-8")
    return csv_path


def sample_suffix(sample: int | None) -> str:
    """File-name suffix for ``--sample`` runs so they never overwrite full runs."""
    return f"_sample{sample}" if sample else ""
