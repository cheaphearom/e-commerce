"""Runs one fault-injection experiment and writes the ground-truth labels.

Timeline:
  1. wait until the gateway and every service report UP on /actuator/health
  2. start Poisson load through the gateway
  3. warm-up: only normal traffic
  4. repeat until the duration is used up:
       inject a random fault (random service, type and severity) for 60-180 s,
       then leave a normal gap of 180-420 s
  5. stop the load and write experiment.json

Output folder:
  labels.csv       fault_id, service, type, start, end, params   (ISO-8601 UTC)
  experiment.json  configuration, start/end of load, warm-up end, final load statistics,
                   and "completed" (false if the run was interrupted)

Only one experiment may run at a time: a lock file ``.experiment-running`` in the parent of the
output folder (e.g. results/) stops a second run from starting and mixing its faults into the
first one. It is removed when the run ends; if a run was killed, delete it by hand.

Faults are activated through each service's /admin/chaos endpoint, which is not routed through
the gateway and does not appear in the logs.

Usage:
    python run_experiment.py --duration-min 180 --warmup-min 10 --rps 5 --seed 42 --out ./results
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import logging
import os
import random
import signal
import socket
import sys
import time
from pathlib import Path

import requests

from load_generator import LoadGenerator

log = logging.getLogger("experiment")

FAULT_TYPES = ("LATENCY", "ERROR", "DB_TIMEOUT")

# Severity presets. Values are passed straight to POST /admin/chaos.
SEVERITY = {
    "LATENCY": {
        "low": {"latencyMs": 400},
        "medium": {"latencyMs": 1200},
        "high": {"latencyMs": 3000},
    },
    "ERROR": {
        "low": {"errorRate": 0.10},
        "medium": {"errorRate": 0.30},
        "high": {"errorRate": 0.60},
    },
    "DB_TIMEOUT": {
        "low": {"latencyMs": 1500, "errorRate": 0.20},
        "medium": {"latencyMs": 3000, "errorRate": 0.40},
        "high": {"latencyMs": 6000, "errorRate": 0.70},
    },
}

LABEL_FIELDS = ("fault_id", "service", "type", "start", "end", "params")
LOCK_NAME = ".experiment-running"


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(ts: dt.datetime) -> str:
    return ts.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def service_urls() -> dict[str, str]:
    return {
        "order-service": os.environ.get("ORDER_SERVICE_URL", "http://localhost:8081"),
        "inventory-service": os.environ.get("INVENTORY_SERVICE_URL", "http://localhost:8082"),
        "payment-service": os.environ.get("PAYMENT_SERVICE_URL", "http://localhost:8083"),
    }


def wait_until_healthy(urls: dict[str, str], timeout_s: float = 600.0) -> None:
    deadline = time.monotonic() + timeout_s
    pending = dict(urls)
    while pending:
        for name, url in list(pending.items()):
            try:
                r = requests.get(url.rstrip("/") + "/actuator/health", timeout=3)
                if r.ok and r.json().get("status") == "UP":
                    log.info("%s is UP", name)
                    del pending[name]
            except (requests.RequestException, ValueError):
                pass
        if not pending:
            return
        if time.monotonic() > deadline:
            raise TimeoutError(f"services not healthy after {timeout_s:.0f}s: {sorted(pending)}")
        time.sleep(3)


def chaos(url: str, method: str, body: dict | None = None) -> dict:
    r = requests.request(method, url.rstrip("/") + "/admin/chaos", json=body, timeout=10)
    r.raise_for_status()
    return r.json()


def acquire_lock(out: Path, force: bool = False) -> Path:
    """Creates the run lock next to the output folder, or exits if another run holds it."""
    out.mkdir(parents=True, exist_ok=True)
    lock = out.resolve().parent / LOCK_NAME
    info = json.dumps({"out": str(out), "started": iso(utc_now()), "host": socket.gethostname()})
    try:
        with lock.open("x", encoding="utf-8") as fh:
            fh.write(info)
    except FileExistsError:
        if not force:
            other = lock.read_text(encoding="utf-8", errors="replace").strip()
            raise SystemExit(
                f"ERROR: another experiment is already running: {other}\n"
                f"Two experiments at the same time inject faults into the same services and spoil "
                f"both results. Wait until it has finished (docker ps).\n"
                f"If no experiment is running any more (for example it was killed), delete "
                f"{lock.name} in the results folder, or pass --force.")
        lock.write_text(info, encoding="utf-8")
    return lock


class Experiment:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.rng = random.Random(args.seed)
        self.services = service_urls()
        self.gateway = os.environ.get("GATEWAY_URL", args.gateway)
        self.out = Path(args.out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.labels_path = self.out / "labels.csv"
        self.active_service: str | None = None
        self.load: LoadGenerator | None = None
        self.completed = False

    def write_label(self, row: dict) -> None:
        new_file = not self.labels_path.exists() or self.labels_path.stat().st_size == 0
        with self.labels_path.open("a", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=LABEL_FIELDS)
            if new_file:
                writer.writeheader()
            writer.writerow(row)
            fh.flush()

    def clear_all(self) -> None:
        for name, url in self.services.items():
            try:
                chaos(url, "DELETE")
            except requests.RequestException as e:
                log.warning("could not clear chaos on %s: %s", name, e)

    def pick_fault(self) -> tuple[str, str, str, dict, int]:
        service = self.rng.choice(sorted(self.services))
        fault_type = self.rng.choice(self.args.types)
        severity = self.rng.choice(("low", "medium", "high"))
        duration = self.rng.randint(self.args.min_fault_s, self.args.max_fault_s)
        params = dict(SEVERITY[fault_type][severity])
        return service, fault_type, severity, params, duration

    def run(self) -> None:
        args = self.args
        if self.labels_path.exists() and not args.append:
            self.labels_path.unlink()

        log.info("waiting for services to become healthy")
        wait_until_healthy({"api-gateway": self.gateway, **self.services}, timeout_s=args.health_timeout_s)
        self.clear_all()

        self.load = LoadGenerator(self.gateway, rps=args.rps, seed=args.seed)
        load_start = utc_now()
        self.load.start()
        experiment_end = time.monotonic() + args.duration_min * 60

        log.info("warm-up: %.1f min of normal traffic", args.warmup_min)
        time.sleep(args.warmup_min * 60)
        warmup_end = utc_now()

        fault_no = 0
        try:
            while True:
                service, fault_type, severity, params, duration = self.pick_fault()
                remaining = experiment_end - time.monotonic()
                if remaining < duration + args.min_gap_s:
                    break
                fault_no += 1
                fault_id = f"F{fault_no:03d}"
                body = {"type": fault_type, "durationSec": duration, **params}
                chaos(self.services[service], "POST", body)
                self.active_service = service
                start = utc_now()
                log.info("%s: %s %s (%s) on %s for %ds", fault_id, fault_type, params, severity, service, duration)
                time.sleep(duration)
                end = utc_now()
                try:
                    chaos(self.services[service], "DELETE")
                except requests.RequestException as e:
                    log.warning("could not clear chaos on %s (it expires by itself): %s", service, e)
                self.active_service = None
                self.write_label({
                    "fault_id": fault_id,
                    "service": service,
                    "type": fault_type,
                    "start": iso(start),
                    "end": iso(end),
                    "params": json.dumps({"severity": severity, "durationSec": duration, **params},
                                         separators=(",", ":")),
                })
                gap = self.rng.randint(args.min_gap_s, args.max_gap_s)
                gap = int(min(gap, max(0.0, experiment_end - time.monotonic())))
                log.info("normal gap of %ds", gap)
                time.sleep(gap)
                if time.monotonic() >= experiment_end:
                    break
            remaining = experiment_end - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
            self.completed = True
        finally:
            if self.active_service:
                self.clear_all()
            self.load.stop()
            load_end = utc_now()
            meta = {
                "seed": args.seed,
                "rps": args.rps,
                "duration_min": args.duration_min,
                "warmup_min": args.warmup_min,
                "fault_duration_s": [args.min_fault_s, args.max_fault_s],
                "gap_s": [args.min_gap_s, args.max_gap_s],
                "fault_types": list(args.types),
                "load_start": iso(load_start),
                "warmup_end": iso(warmup_end),
                "load_end": iso(load_end),
                "faults": fault_no,
                "completed": self.completed,
                "load_stats": self.load.stats.snapshot(),
            }
            (self.out / "experiment.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
            if self.completed:
                log.info("experiment finished: %d faults, labels in %s", fault_no, self.labels_path)
            else:
                log.warning("experiment stopped early after %d faults; it is marked as incomplete", fault_no)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--duration-min", type=float, default=180.0, help="total experiment length incl. warm-up")
    p.add_argument("--warmup-min", type=float, default=10.0, help="normal traffic before the first fault")
    p.add_argument("--rps", type=float, default=5.0, help="mean request rate through the gateway")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out", default="results", help="output folder for labels.csv and experiment.json")
    p.add_argument("--gateway", default="http://localhost:8080", help="overridden by $GATEWAY_URL")
    p.add_argument("--min-fault-s", type=int, default=60)
    p.add_argument("--max-fault-s", type=int, default=180)
    p.add_argument("--min-gap-s", type=int, default=180)
    p.add_argument("--max-gap-s", type=int, default=420)
    p.add_argument("--types", nargs="+", choices=FAULT_TYPES, default=list(FAULT_TYPES))
    p.add_argument("--health-timeout-s", type=float, default=600.0)
    p.add_argument("--append", action="store_true", help="append to an existing labels.csv")
    p.add_argument("--force", action="store_true",
                   help="start even if the lock says another experiment is running")
    args = p.parse_args(argv)
    if args.min_fault_s > args.max_fault_s or args.min_gap_s > args.max_gap_s:
        p.error("min values must not exceed max values")
    if args.warmup_min >= args.duration_min:
        p.error("--warmup-min must be shorter than --duration-min")
    return args


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = parse_args(argv)
    lock = acquire_lock(Path(args.out), force=args.force)
    experiment = Experiment(args)

    def on_signal(signum, _frame):
        log.warning("signal %s received, stopping", signum)
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_signal)
    try:
        experiment.run()
    except KeyboardInterrupt:
        log.warning("experiment interrupted; labels written so far are kept")
        sys.exit(130)
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
