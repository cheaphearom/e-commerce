"""Command line interface.

    python -m detector.cli evaluate --logs ../logs --labels ../results/labels.csv --out ../results/eval
    python -m detector.cli synth --out ./synthetic --duration-min 120 --seed 1
"""
from __future__ import annotations

import argparse
import json
import sys

from .evaluate import evaluate_paths
from .models import METHOD_LABELS, METHOD_ORDER
from .synthetic import generate


def _summary(results: dict) -> str:
    lines = [f"{'method':<18}{'P':>7}{'R':>7}{'F1':>7}{'AUC':>7}{'FPR':>7}{'det.':>8}{'mean delay':>12}"]
    for m in METHOD_ORDER:
        r, d = results["metrics"][m], results["detection_delay"][m]
        auc = f"{r['roc_auc']:.3f}" if r["roc_auc"] is not None else "-"
        delay = f"{d['mean_delay_s']:.1f}s" if d["mean_delay_s"] is not None else "-"
        lines.append(f"{METHOD_LABELS[m]:<18}{r['precision']:>7.3f}{r['recall']:>7.3f}{r['f1']:>7.3f}{auc:>7}"
                     f"{r['false_positive_rate']:>7.3f}{d['detected']:>4}/{d['faults']:<3}{delay:>12}")
    for m, c in results["comparison_vs_rules"].items():
        saved = f"{c['mean_time_saved_s']:.1f}s" if c["mean_time_saved_s"] is not None else "-"
        lines.append(f"{METHOD_LABELS[m]} vs rules: earlier={c['earlier']} same={c['same']} "
                     f"later_or_missed={c['later_or_missed']} both_missed={c['both_missed']} mean_saved={saved}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="detector", description="Log anomaly detection for the saga system")
    sub = parser.add_subparsers(dest="command", required=True)

    ev = sub.add_parser("evaluate", help="compare rules, Isolation Forest and Random Forest")
    ev.add_argument("--logs", required=True, help="log directory (or a single log file)")
    ev.add_argument("--labels", required=True, help="labels.csv written by the experiment runner")
    ev.add_argument("--out", required=True, help="output folder for results.json, report.md and figures")
    ev.add_argument("--window", type=float, default=30.0, help="window length in seconds")
    ev.add_argument("--step", type=float, default=10.0, help="window step in seconds")
    ev.add_argument("--train-frac", type=float, default=0.6, help="chronological share used for training")
    ev.add_argument("--grace", type=float, default=15.0, help="seconds after a fault still labelled anomalous")
    ev.add_argument("--seed", type=int, default=42)
    ev.add_argument("--start", help="ISO timestamp; default: load_start from experiment.json")
    ev.add_argument("--end", help="ISO timestamp; default: load_end from experiment.json")
    ev.add_argument("--no-figures", action="store_true")
    ev.add_argument("--allow-incomplete", action="store_true",
                    help="evaluate an experiment that is still running or was interrupted")
    ev.add_argument("--json", action="store_true", help="print results.json instead of the summary")

    sy = sub.add_parser("synth", help="generate synthetic logs (testing only, not for thesis results)")
    sy.add_argument("--out", required=True)
    sy.add_argument("--duration-min", type=float, default=120.0)
    sy.add_argument("--warmup-min", type=float, default=10.0)
    sy.add_argument("--rps", type=float, default=5.0)
    sy.add_argument("--seed", type=int, default=1)
    sy.add_argument("--min-fault-s", type=int, default=60)
    sy.add_argument("--max-fault-s", type=int, default=180)
    sy.add_argument("--min-gap-s", type=int, default=180)
    sy.add_argument("--max-gap-s", type=int, default=420)
    sy.add_argument("--ramp-frac", type=float, default=0.4, help="share of a fault spent ramping up")

    args = parser.parse_args(argv)
    if args.command == "evaluate":
        try:
            results = evaluate_paths(args.logs, args.labels, out_dir=args.out, window=args.window, step=args.step,
                                     train_frac=args.train_frac, grace=args.grace, seed=args.seed,
                                     start=args.start, end=args.end, make_figures=not args.no_figures,
                                     allow_incomplete=args.allow_incomplete)
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
        print(json.dumps(results, indent=2, default=str) if args.json else _summary(results))
        print(f"\nwritten to {args.out}", file=sys.stderr)
        return 0
    if args.command == "synth":
        meta = generate(args.out, duration_min=args.duration_min, warmup_min=args.warmup_min, rps=args.rps,
                        seed=args.seed, min_fault_s=args.min_fault_s, max_fault_s=args.max_fault_s,
                        min_gap_s=args.min_gap_s, max_gap_s=args.max_gap_s, ramp_frac=args.ramp_frac)
        print(f"{meta['faults']} faults over {meta['duration_min']} min written to {args.out}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
