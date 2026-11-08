"""Offline evaluation: Rule-based vs Isolation Forest vs Random Forest.

Pipeline
  1. parse logs, build 30 s / 10 s sliding windows, label windows that overlap
     [fault start, fault end + grace]
  2. chronological split: windows ending before ``t_split`` train, windows starting after it
     test; windows that cross the split are dropped (no leakage through overlapping windows)
  3. "unseen templates" are counted against the templates of the normal training logs
  4. fit the detectors on the training windows, score the test windows
  5. metrics (Q1/Q2), per-fault detection delay and comparison with the rules (Q3)

Outputs in ``out_dir``: results.json, report.md, detection_delays.csv, timeline.png,
metrics.png, detection_delay.png.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support, roc_auc_score

from .features import (
    SERVICES, add_unseen_templates, build_windows, feature_name, in_fault_mask, known_templates,
    label_windows,
)
from .models import (
    METHOD_LABELS, METHOD_ORDER, IsolationForestDetector, RandomForestDetector, RuleBasedDetector,
)
from .parsing import load_experiment_meta, load_labels, load_logs

# Reference palette, first three categorical slots (validated adjacent and all-pairs).
COLORS = {
    RuleBasedDetector.name: "#2a78d6",
    IsolationForestDetector.name: "#eb6834",
    RandomForestDetector.name: "#1baf7a",
}
SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e4e3df"
FAULT_SHADE = "#d6d5d0"


@dataclass
class Dataset:
    windows: pd.DataFrame
    train: pd.DataFrame
    test: pd.DataFrame
    labels: pd.DataFrame
    t_split: float
    known_templates: set[str]
    window: float
    step: float
    grace: float
    meta: dict = field(default_factory=dict)


def prepare_dataset(logs: pd.DataFrame, labels: pd.DataFrame, window: float = 30.0, step: float = 10.0,
                    train_frac: float = 0.6, grace: float = 15.0,
                    start: pd.Timestamp | None = None, end: pd.Timestamp | None = None) -> Dataset:
    """Builds labelled windows and the chronological train/test split."""
    if not 0.0 < train_frac < 1.0:
        raise ValueError("train_frac must be between 0 and 1")
    if start is not None:
        logs = logs[logs["ts"] >= start]
    if end is not None:
        logs = logs[logs["ts"] <= end]
    logs = logs.reset_index(drop=True)
    if logs.empty:
        raise ValueError("no log records in the selected period")

    windows = build_windows(logs, window=window, step=step)
    if len(windows) < 20:
        raise ValueError(f"only {len(windows)} windows - the log period is too short to evaluate")
    windows = label_windows(windows, labels, grace=grace)

    t0 = float(windows["window_start"].min())
    t1 = float(windows["window_end"].max())
    t_split = t0 + train_frac * (t1 - t0)

    normal_train_logs = (logs["t"].to_numpy() < t_split) & ~in_fault_mask(logs["t"].to_numpy(), labels, grace)
    known = known_templates(logs, normal_train_logs)
    windows = add_unseen_templates(windows, logs, known)

    train = windows[windows["window_end"] <= t_split].reset_index(drop=True)
    test = windows[windows["window_start"] >= t_split].reset_index(drop=True)
    return Dataset(windows=windows, train=train, test=test, labels=labels, t_split=t_split,
                   known_templates=known, window=window, step=step, grace=grace)


def make_detectors(step: float, seed: int) -> dict:
    return {
        RuleBasedDetector.name: RuleBasedDetector(step=step),
        IsolationForestDetector.name: IsolationForestDetector(random_state=seed),
        RandomForestDetector.name: RandomForestDetector(random_state=seed),
    }


# ---------------------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------------------
def alert_episodes(pred: np.ndarray, starts: np.ndarray, step: float) -> list[tuple[int, int]]:
    """Maximal runs of consecutive alerting windows as (first index, last index)."""
    episodes = []
    i, n = 0, len(pred)
    while i < n:
        if pred[i]:
            j = i
            while j + 1 < n and pred[j + 1] and abs(starts[j + 1] - starts[j] - step) <= step * 0.5:
                j += 1
            episodes.append((i, j))
            i = j + 1
        else:
            i += 1
    return episodes


def classification_metrics(y: np.ndarray, pred: np.ndarray, score: np.ndarray,
                           starts: np.ndarray, step: float, hours: float) -> dict:
    y = np.asarray(y, dtype=int)
    pred = np.asarray(pred, dtype=int)
    p, r, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    auc = None
    if np.unique(y).size == 2 and np.all(np.isfinite(score)):
        auc = float(roc_auc_score(y, score))
    episodes = alert_episodes(pred, starts, step)
    false_episodes = sum(1 for a, b in episodes if y[a:b + 1].sum() == 0)
    return {
        "precision": float(p),
        "recall": float(r),
        "f1": float(f1),
        "roc_auc": auc,
        "false_positive_rate": float(fp / (fp + tn)) if (fp + tn) else 0.0,
        "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn),
        "alert_episodes": len(episodes),
        "false_alarm_episodes": int(false_episodes),
        "false_alarms_per_hour": float(false_episodes / hours) if hours > 0 else 0.0,
    }


def detection_delays(test: pd.DataFrame, labels: pd.DataFrame, preds: dict[str, np.ndarray],
                     t_split: float, grace: float) -> pd.DataFrame:
    """Per fault in the test period: delay = end of the first alerting window - fault start."""
    ws = test["window_start"].to_numpy()
    we = test["window_end"].to_numpy()
    rows = []
    for f in labels.itertuples(index=False):
        s = f.start.timestamp()
        e = f.end.timestamp()
        if s < t_split or s > we.max(initial=-math.inf):
            continue
        in_scope = (we > s) & (ws <= e + grace)
        row = {
            "fault_id": f.fault_id, "service": f.service, "type": f.type,
            "start": f.start.isoformat(), "end": f.end.isoformat(),
            "duration_s": round(e - s, 3), "params": f.params,
        }
        for name, pred in preds.items():
            hits = np.flatnonzero(in_scope & (pred == 1))
            if hits.size:
                first = hits[np.argmin(we[hits])]
                row[f"{name}_detected"] = True
                row[f"{name}_delay_s"] = round(float(we[first] - s), 3)
            else:
                row[f"{name}_detected"] = False
                row[f"{name}_delay_s"] = np.nan
        rows.append(row)
    columns = ["fault_id", "service", "type", "start", "end", "duration_s", "params"]
    for name in preds:
        columns += [f"{name}_detected", f"{name}_delay_s"]
    return pd.DataFrame(rows, columns=columns)


def delay_summary(delays: pd.DataFrame, method: str) -> dict:
    n = len(delays)
    if n == 0:
        return {"faults": 0, "detected": 0, "detection_rate": None,
                "mean_delay_s": None, "median_delay_s": None, "max_delay_s": None}
    d = delays.loc[delays[f"{method}_detected"], f"{method}_delay_s"]
    return {
        "faults": int(n),
        "detected": int(d.size),
        "detection_rate": float(d.size / n),
        "mean_delay_s": float(d.mean()) if d.size else None,
        "median_delay_s": float(d.median()) if d.size else None,
        "max_delay_s": float(d.max()) if d.size else None,
    }


def compare_with_rules(delays: pd.DataFrame, method: str, eps: float = 1e-6) -> dict:
    """Per fault: did ``method`` alert earlier than, at the same time as, or later than the rules?"""
    counts = {"earlier": 0, "same": 0, "later_or_missed": 0, "both_missed": 0}
    saved = []
    for _, row in delays.iterrows():
        ml_hit, rule_hit = bool(row[f"{method}_detected"]), bool(row["rules_detected"])
        ml_d, rule_d = row[f"{method}_delay_s"], row["rules_delay_s"]
        if not ml_hit and not rule_hit:
            counts["both_missed"] += 1
        elif ml_hit and not rule_hit:
            counts["earlier"] += 1
        elif rule_hit and not ml_hit:
            counts["later_or_missed"] += 1
        else:
            saved.append(rule_d - ml_d)
            if ml_d < rule_d - eps:
                counts["earlier"] += 1
            elif abs(ml_d - rule_d) <= eps:
                counts["same"] += 1
            else:
                counts["later_or_missed"] += 1
    return {
        **counts,
        "faults_detected_by_both": len(saved),
        "mean_time_saved_s": float(np.mean(saved)) if saved else None,
        "median_time_saved_s": float(np.median(saved)) if saved else None,
        "detected_only_by_ml": int(sum(1 for _, r in delays.iterrows()
                                       if r[f"{method}_detected"] and not r["rules_detected"])),
    }


def breakdown(delays: pd.DataFrame, by: str, methods: list[str]) -> dict:
    result = {}
    for key, group in delays.groupby(by, sort=True):
        result[str(key)] = {"faults": int(len(group))}
        for m in methods:
            result[str(key)][m] = delay_summary(group, m)
    return result


# ---------------------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------------------
def evaluate(logs: pd.DataFrame, labels: pd.DataFrame, window: float = 30.0, step: float = 10.0,
             train_frac: float = 0.6, grace: float = 15.0, seed: int = 42,
             start: pd.Timestamp | None = None, end: pd.Timestamp | None = None,
             out_dir: str | os.PathLike | None = None, meta: dict | None = None,
             make_figures: bool = True) -> dict:
    """Runs the full comparison and (optionally) writes every output file to ``out_dir``."""
    if labels.empty:
        raise ValueError("labels are empty - the evaluation needs at least one injected fault")
    ds = prepare_dataset(logs, labels, window, step, train_frac, grace, start, end)
    train, test = ds.train, ds.test
    if train["label"].sum() == 0:
        raise ValueError("no anomalous windows in the training period - run a longer experiment "
                         "or increase --train-frac")
    if len(test) == 0:
        raise ValueError("no test windows - decrease --train-frac")

    detectors = make_detectors(step, seed)
    y_train = train["label"].to_numpy()
    for det in detectors.values():
        det.fit(train, y_train)

    y_test = test["label"].to_numpy()
    starts = test["window_start"].to_numpy()
    test_hours = (test["window_end"].max() - test["window_start"].min()) / 3600.0
    scores, preds, metrics = {}, {}, {}
    for name, det in detectors.items():
        scores[name] = det.score(test)
        preds[name] = det.predict(test)
        metrics[name] = classification_metrics(y_test, preds[name], scores[name], starts, step, test_hours)

    delays = detection_delays(test, labels, preds, ds.t_split, grace)
    methods = list(detectors)
    delay_stats = {m: delay_summary(delays, m) for m in methods}
    comparison = {m: compare_with_rules(delays, m) for m in methods if m != RuleBasedDetector.name}

    rf: RandomForestDetector = detectors[RandomForestDetector.name]
    iso: IsolationForestDetector = detectors[IsolationForestDetector.name]
    results = {
        "config": {
            "window_s": window, "step_s": step, "train_frac": train_frac, "grace_s": grace, "seed": seed,
            "rules": vars(detectors[RuleBasedDetector.name].config) | {},
            "isolation_forest": {"n_estimators": iso.n_estimators, "percentile": iso.percentile,
                                 "threshold": iso.threshold_, "features": iso.columns_},
            "random_forest": {"n_estimators": rf.n_estimators, "class_weight": "balanced",
                              "threshold": rf.threshold},
        },
        "dataset": {
            "log_records": int(len(logs)),
            "windows_total": int(len(ds.windows)),
            "windows_train": int(len(train)),
            "windows_test": int(len(test)),
            "windows_dropped_at_split": int(len(ds.windows) - len(train) - len(test)),
            "anomalous_windows_train": int(train["label"].sum()),
            "anomalous_windows_test": int(test["label"].sum()),
            "faults_total": int(len(labels)),
            "faults_test": int(len(delays)),
            "known_templates": len(ds.known_templates),
            "period_start": pd.Timestamp(ds.windows["window_start"].min(), unit="s", tz="UTC").isoformat(),
            "split_at": pd.Timestamp(ds.t_split, unit="s", tz="UTC").isoformat(),
            "period_end": pd.Timestamp(ds.windows["window_end"].max(), unit="s", tz="UTC").isoformat(),
            "test_hours": float(test_hours),
            "experiment": meta or {},
        },
        "metrics": metrics,
        "detection_delay": delay_stats,
        "comparison_vs_rules": comparison,
        "by_fault_type": breakdown(delays, "type", methods) if len(delays) else {},
        "by_service": breakdown(delays, "service", methods) if len(delays) else {},
        "feature_importance": [{"feature": f, "importance": v} for f, v in rf.feature_importance(top=20)],
    }

    if out_dir is not None:
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "results.json").write_text(json.dumps(_json_safe(results), indent=2), encoding="utf-8")
        delays.to_csv(out / "detection_delays.csv", index=False)
        (out / "report.md").write_text(render_report(results, delays), encoding="utf-8")
        if make_figures:
            plot_timeline(test, labels, preds, ds.t_split, grace, out / "timeline.png")
            plot_metrics(metrics, out / "metrics.png")
            plot_delays(delays, methods, out / "detection_delay.png")
        results["outputs"] = sorted(p.name for p in out.iterdir() if p.is_file())
    return results


def evaluate_paths(logs_path: str | os.PathLike, labels_path: str | os.PathLike, out_dir=None,
                   window: float = 30.0, step: float = 10.0, train_frac: float = 0.6, grace: float = 15.0,
                   seed: int = 42, start: str | None = None, end: str | None = None,
                   make_figures: bool = True) -> dict:
    """Loads logs and labels from disk and runs :func:`evaluate`.

    If ``experiment.json`` lies next to ``labels.csv``, the evaluation period defaults to the
    time the load generator ran, which keeps service start-up logs out of the data.
    """
    labels = load_labels(labels_path)
    meta = load_experiment_meta(labels_path)
    start_ts = pd.Timestamp(start) if start else (pd.Timestamp(meta["load_start"]) if meta.get("load_start") else None)
    end_ts = pd.Timestamp(end) if end else (pd.Timestamp(meta["load_end"]) if meta.get("load_end") else None)
    start_ts = _utc(start_ts)
    end_ts = _utc(end_ts)
    logs = load_logs(logs_path, start=start_ts, end=end_ts)
    return evaluate(logs, labels, window=window, step=step, train_frac=train_frac, grace=grace, seed=seed,
                    out_dir=out_dir, meta=meta, make_figures=make_figures)


def _utc(ts: pd.Timestamp | None) -> pd.Timestamp | None:
    if ts is None:
        return None
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def _json_safe(obj):
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return None if not math.isfinite(float(obj)) else float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


# ---------------------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------------------
def _fmt(v, digits: int = 3, suffix: str = "") -> str:
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return "–"
    if isinstance(v, float):
        return f"{v:.{digits}f}{suffix}"
    return f"{v}{suffix}"


def render_report(results: dict, delays: pd.DataFrame) -> str:
    ds = results["dataset"]
    cfg = results["config"]
    lines = [
        "# Anomaly detection evaluation report",
        "",
        "## Dataset",
        "",
        f"- Period: {ds['period_start']} → {ds['period_end']} (train/test split at {ds['split_at']})",
        f"- Log records: {ds['log_records']:,}; known normal templates: {ds['known_templates']}",
        f"- Windows: {ds['windows_total']} ({cfg['window_s']:.0f} s window, {cfg['step_s']:.0f} s step); "
        f"train {ds['windows_train']} ({ds['anomalous_windows_train']} anomalous), "
        f"test {ds['windows_test']} ({ds['anomalous_windows_test']} anomalous), "
        f"{ds['windows_dropped_at_split']} dropped at the split",
        f"- Faults: {ds['faults_total']} injected, {ds['faults_test']} in the test period; "
        f"window label grace period {cfg['grace_s']:.0f} s",
        "",
        "## Q1 / Q2 – Detection quality on the test windows",
        "",
        "| Method | Precision | Recall | F1 | ROC-AUC | FPR | False-alarm episodes | False alarms / h |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for m in METHOD_ORDER:
        r = results["metrics"][m]
        lines.append(f"| {METHOD_LABELS[m]} | {_fmt(r['precision'])} | {_fmt(r['recall'])} | {_fmt(r['f1'])} | "
                     f"{_fmt(r['roc_auc'])} | {_fmt(r['false_positive_rate'])} | {r['false_alarm_episodes']} | "
                     f"{_fmt(r['false_alarms_per_hour'], 2)} |")
    lines += [
        "",
        "Confusion counts (windows):",
        "",
        "| Method | TP | FP | TN | FN |",
        "|---|---:|---:|---:|---:|",
    ]
    for m in METHOD_ORDER:
        r = results["metrics"][m]
        lines.append(f"| {METHOD_LABELS[m]} | {r['tp']} | {r['fp']} | {r['tn']} | {r['fn']} |")

    lines += [
        "",
        "## Q3 – Detection delay (end of first alerting window − fault start)",
        "",
        "| Method | Detected | Detection rate | Mean delay | Median delay | Max delay |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for m in METHOD_ORDER:
        d = results["detection_delay"][m]
        lines.append(f"| {METHOD_LABELS[m]} | {d['detected']}/{d['faults']} | {_fmt(d['detection_rate'], 2)} | "
                     f"{_fmt(d['mean_delay_s'], 1, ' s')} | {_fmt(d['median_delay_s'], 1, ' s')} | "
                     f"{_fmt(d['max_delay_s'], 1, ' s')} |")
    lines += [
        "",
        "### ML compared with the rules, per fault",
        "",
        "| Method | Earlier | Same | Later or missed | Both missed | Only ML detected | Mean time saved | Median time saved |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for m, c in results["comparison_vs_rules"].items():
        lines.append(f"| {METHOD_LABELS[m]} | {c['earlier']} | {c['same']} | {c['later_or_missed']} | "
                     f"{c['both_missed']} | {c['detected_only_by_ml']} | {_fmt(c['mean_time_saved_s'], 1, ' s')} | "
                     f"{_fmt(c['median_time_saved_s'], 1, ' s')} |")
    lines.append("")
    lines.append("Time saved = rule delay − ML delay, over faults detected by both (positive = ML earlier).")

    for title, key in (("By fault type", "by_fault_type"), ("By target service", "by_service")):
        if not results[key]:
            continue
        lines += ["", f"### {title}", "",
                  "| Group | Faults | " + " | ".join(f"{METHOD_LABELS[m]} detected / mean delay" for m in METHOD_ORDER) + " |",
                  "|---|---:|" + "---:|" * len(METHOD_ORDER)]
        for group, stats in results[key].items():
            cells = []
            for m in METHOD_ORDER:
                s = stats[m]
                cells.append(f"{s['detected']}/{s['faults']} / {_fmt(s['mean_delay_s'], 1, ' s')}")
            lines.append(f"| {group} | {stats['faults']} | " + " | ".join(cells) + " |")

    lines += ["", "## Random Forest feature importance (top 20)", "", "| Feature | Importance |", "|---|---:|"]
    for item in results["feature_importance"]:
        lines.append(f"| `{item['feature']}` | {item['importance']:.4f} |")

    if len(delays):
        lines += ["", "## Per-fault detection delays", "",
                  "| Fault | Service | Type | Duration | " + " | ".join(METHOD_LABELS[m] for m in METHOD_ORDER) + " |",
                  "|---|---|---|---:|" + "---:|" * len(METHOD_ORDER)]
        for _, r in delays.iterrows():
            cells = [(_fmt(r[f"{m}_delay_s"], 0, " s") if r[f"{m}_detected"] else "missed") for m in METHOD_ORDER]
            lines.append(f"| {r['fault_id']} | {r['service']} | {r['type']} | {r['duration_s']:.0f} s | "
                         + " | ".join(cells) + " |")

    lines += ["", "## Figures", "",
              "- `timeline.png` – test period: gateway latency, error lines, faults and alerts per method",
              "- `metrics.png` – precision, recall and F1 per method",
              "- `detection_delay.png` – distribution of per-fault detection delays", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------------------
def _style_axes(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=TEXT_SECONDARY, labelsize=9)
    ax.yaxis.label.set_color(TEXT_SECONDARY)
    ax.xaxis.label.set_color(TEXT_SECONDARY)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def _plt():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size": 10, "text.color": TEXT, "axes.titlecolor": TEXT,
                         "axes.titlesize": 11, "axes.titleweight": "bold", "axes.titlelocation": "left",
                         "figure.facecolor": SURFACE, "savefig.facecolor": SURFACE})
    return plt


def plot_timeline(test: pd.DataFrame, labels: pd.DataFrame, preds: dict[str, np.ndarray],
                  t_split: float, grace: float, path: Path) -> None:
    plt = _plt()
    t0 = float(test["window_start"].min())
    x = (test["window_end"].to_numpy() - t0) / 60.0
    fig, axes = plt.subplots(3, 1, figsize=(12, 7.2), sharex=True,
                             gridspec_kw={"height_ratios": [2, 2, 1.6]})
    faults = [(f.start.timestamp(), f.end.timestamp(), f.type, f.service)
              for f in labels.itertuples(index=False) if f.end.timestamp() >= t0]

    def shade(ax):
        for s, e, *_ in faults:
            ax.axvspan((s - t0) / 60.0, (e - t0) / 60.0, color=FAULT_SHADE, alpha=0.6, linewidth=0)

    ax = axes[0]
    _style_axes(ax)
    shade(ax)
    p95 = test[feature_name("api-gateway", "latency_p95")].to_numpy() / 1000.0
    ax.plot(x, p95, color=TEXT_SECONDARY, linewidth=1.5)
    ax.set_ylim(0, max(float(np.nanmax(p95)) if p95.size else 0.0, 0.1) * 1.35)
    ax.set_ylabel("p95 latency (s)")
    ax.set_title("Gateway p95 latency per window (shaded = injected fault)")
    for s, e, ftype, svc in faults:
        ax.annotate(f"{ftype}\n{svc.replace('-service', '')}", xy=(((s + e) / 2 - t0) / 60.0, 1.0),
                    xycoords=("data", "axes fraction"), ha="center", va="top", fontsize=7,
                    color=TEXT_SECONDARY)

    ax = axes[1]
    _style_axes(ax)
    shade(ax)
    errors = sum(test[feature_name(s, "error_count")].to_numpy() for s in SERVICES)
    ax.plot(x, errors, color=TEXT_SECONDARY, linewidth=1.5)
    ax.set_ylabel("ERROR lines")
    ax.set_title("ERROR log lines per window, all services")

    ax = axes[2]
    _style_axes(ax)
    ax.grid(False)
    shade(ax)
    width = (test["window_end"].iloc[0] - test["window_start"].iloc[0]) / 60.0 if len(test) else 0.5
    step_min = (test["window_start"].diff().median() / 60.0) if len(test) > 1 else width
    for row, m in enumerate(METHOD_ORDER):
        idx = np.flatnonzero(preds[m] == 1)
        bars = [(x[i] - step_min, step_min) for i in idx]
        ax.broken_barh(bars, (row - 0.35, 0.7), facecolors=COLORS[m], edgecolor=SURFACE, linewidth=0.3)
    ax.set_yticks(range(len(METHOD_ORDER)), [METHOD_LABELS[m] for m in METHOD_ORDER])
    ax.set_ylim(-0.6, len(METHOD_ORDER) - 0.4)
    ax.invert_yaxis()
    ax.set_title("Alerts (window end time)")
    ax.set_xlabel("Minutes since start of test period")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_metrics(metrics: dict, path: Path) -> None:
    plt = _plt()
    names = ["precision", "recall", "f1"]
    fig, ax = plt.subplots(figsize=(8, 4.2))
    _style_axes(ax)
    n = len(METHOD_ORDER)
    width = 0.8 / n
    xs = np.arange(len(names))
    for i, m in enumerate(METHOD_ORDER):
        values = [metrics[m][k] for k in names]
        pos = xs - 0.4 + width * (i + 0.5)
        bars = ax.bar(pos, values, width=width * 0.92, color=COLORS[m], label=METHOD_LABELS[m])
        for b, v in zip(bars, values):
            ax.text(b.get_x() + b.get_width() / 2, v + 0.015, f"{v:.2f}", ha="center", va="bottom",
                    fontsize=8, color=TEXT_SECONDARY)
    ax.set_xticks(xs, ["Precision", "Recall", "F1"])
    ax.set_ylim(0, 1.1)
    ax.set_ylabel("Score (test windows)")
    ax.set_title("Detection quality per method")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=n, fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_delays(delays: pd.DataFrame, methods: list[str], path: Path) -> None:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(8, 4.2))
    _style_axes(ax)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.grid(axis="y", visible=False)
    rng = np.random.default_rng(0)
    order = [m for m in METHOD_ORDER if m in methods]
    labels = []
    for row, m in enumerate(order):
        if len(delays):
            d = delays.loc[delays[f"{m}_detected"], f"{m}_delay_s"].to_numpy(dtype=float)
            total = len(delays)
        else:
            d, total = np.empty(0), 0
        if d.size:
            ax.boxplot(d, positions=[row], vert=False, widths=0.5, showfliers=False,
                       medianprops={"color": TEXT, "linewidth": 1.5},
                       boxprops={"color": TEXT_SECONDARY}, whiskerprops={"color": TEXT_SECONDARY},
                       capprops={"color": TEXT_SECONDARY})
            ax.scatter(d, row + rng.uniform(-0.15, 0.15, d.size), s=36, color=COLORS[m],
                       edgecolors=SURFACE, linewidths=1.5, zorder=3)
        labels.append(f"{METHOD_LABELS[m]}\n{d.size}/{total} detected")
    ax.set_yticks(range(len(order)), labels)
    ax.invert_yaxis()
    ax.set_xlabel("Detection delay (s) – end of first alerting window minus fault start")
    ax.set_title("Detection delay per injected fault (test period)")
    ax.set_xlim(left=0)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
