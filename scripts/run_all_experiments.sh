#!/usr/bin/env bash
# Runs the whole thesis evaluation overnight: 5 experiments (seeds 1-5, 3 h each), evaluates
# each run, then aggregates them and runs one cross-run check (run_1 -> run_2).
#
#   scripts/run_all_experiments.sh              run everything (about 16 hours)
#   scripts/run_all_experiments.sh --dry-run    print the commands without running them
#
# Settings (environment variables): SEEDS="1 2 3 4 5" DURATION_MIN=180 WARMUP_MIN=10 RPS=5
#   OVERHEAD_MIN=8 FINAL_MIN=10 (only for the time estimate), FLUSH_WAIT_S=15
#
# For every seed:
#   1. docker compose up -d --build --wait     (start the stack, wait until it is healthy)
#   2. clear ./logs                            (truncate the active files, delete rotated ones)
#   3. run the experiment into results/run_<seed>
#   4. copy ./logs to results/run_<seed>/logs and evaluate them into results/run_<seed>/detector
# Then: aggregate -> results/summary, cross run_<first> -> run_<second> -> results/cross_<a>_<b>
#
# Safety:
#   * stops at the first error (set -e) and says which step failed
#   * refuses to start, and refuses to clear ./logs, while results/.experiment-running exists
#     (the lock of the experiment runner: another experiment is running)
#   * a second copy of this script refuses to start (.run-all-experiments.lock in the repository)
#   * a seed whose run is already complete and evaluated is skipped, so a failed night can be
#     resumed by starting the script again; a half-finished run folder stops the script
#
# Clearing, copying, evaluating and aggregating run inside the project's containers, so files
# written by the containers (owned by root on Linux) need no sudo on the host.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SEEDS="${SEEDS:-1 2 3 4 5}"
DURATION_MIN="${DURATION_MIN:-180}"
WARMUP_MIN="${WARMUP_MIN:-10}"
RPS="${RPS:-5}"
OVERHEAD_MIN="${OVERHEAD_MIN:-8}"     # start-up, health wait, log copy and evaluation per run
FINAL_MIN="${FINAL_MIN:-10}"          # aggregate + cross at the end
FLUSH_WAIT_S="${FLUSH_WAIT_S:-15}"    # wait for the asynchronous log appenders before copying

RESULTS="$ROOT/results"
LOGS="$ROOT/logs"
RUNNER_LOCK="$RESULTS/.experiment-running"
SCRIPT_LOCK="$ROOT/.run-all-experiments.lock"   # not in results/: Docker may own that folder
DRY_RUN=0
STEP="setup"

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

run() {  # run (or, with --dry-run, print) a command
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '+ %s\n' "$*"
  else
    "$@"
  fi
}

on_error() {
  local code=$?
  log "ERROR: step '$STEP' failed (exit code $code). The script stopped; finished runs are kept."
  log "Fix the problem and start the script again: completed runs are skipped."
  exit "$code"
}
trap on_error ERR

cleanup() { [[ $DRY_RUN -eq 1 ]] || rm -f "$SCRIPT_LOCK"; }

check_runner_lock() {
  if [[ -e "$RUNNER_LOCK" ]]; then
    echo "ERROR: $RUNNER_LOCK exists: another experiment is running." >&2
    echo "  $(cat "$RUNNER_LOCK" 2>/dev/null || true)" >&2
    echo "Wait until it has finished (docker ps). If no experiment is running any more" >&2
    echo "(for example it was killed), delete the file and start this script again." >&2
    exit 3
  fi
}

run_complete() {  # 0 if results/run_<seed> finished and was evaluated
  local dir="$RESULTS/run_$1"
  [[ -f "$dir/detector/results.json" && -f "$dir/experiment.json" ]] \
    && grep -q '"completed": *true' "$dir/experiment.json"
}

compose() { run docker compose "$@"; }
in_experiment() { compose --profile experiment run --rm --no-deps --entrypoint sh experiment -c "$1"; }
detector_cli() { compose run --rm --no-deps ml-detector python -m detector.cli "$@"; }

# ---------------------------------------------------------------------------------------------
read -r -a SEED_LIST <<< "$SEEDS"
n=${#SEED_LIST[@]}
if (( n < 2 )); then echo "SEEDS needs at least two seeds (aggregate and cross compare runs)" >&2; exit 2; fi
total_min=$(( n * (DURATION_MIN + OVERHEAD_MIN) + FINAL_MIN ))
finish=$(date -d "+${total_min} minutes" '+%a %H:%M' 2>/dev/null || date -v+"${total_min}"M '+%a %H:%M' 2>/dev/null || echo "?")
log "Plan: $n runs (seeds: $SEEDS), ${DURATION_MIN} min each incl. ${WARMUP_MIN} min warm-up, ${RPS} req/s"
log "Expected total run time: about $(( total_min / 60 )) h $(( total_min % 60 )) min" \
    "(${n} x (${DURATION_MIN} + ~${OVERHEAD_MIN}) min + ~${FINAL_MIN} min aggregate/cross); finished around ${finish}."
log "Run it overnight; keep the shop page closed (its requests would be real traffic in the logs)."

check_runner_lock
if [[ $DRY_RUN -eq 0 ]]; then
  docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose v2 is required" >&2; exit 2; }
  if ! ( set -o noclobber; echo "$$ $(date -u +%FT%TZ)" > "$SCRIPT_LOCK" ) 2>/dev/null; then
    echo "ERROR: $SCRIPT_LOCK exists: this script is already running ($(cat "$SCRIPT_LOCK"))." >&2
    echo "If it is not (for example it was killed), delete the file and start again." >&2
    exit 3
  fi
  trap cleanup EXIT
fi

for seed in "${SEED_LIST[@]}"; do
  out="run_$seed"
  if run_complete "$seed"; then
    log "[$out] already complete and evaluated - skipped"
    continue
  fi
  if [[ -e "$RESULTS/$out" && $DRY_RUN -eq 0 ]]; then
    echo "ERROR: $RESULTS/$out exists but is not a complete, evaluated run." >&2
    echo "Delete or rename it to repeat seed $seed, then start the script again." >&2
    exit 4
  fi

  STEP="$out: start the stack"
  log "[$out] starting the stack and waiting until it is healthy"
  compose up -d --build --wait --wait-timeout 900

  STEP="$out: clear ./logs"
  check_runner_lock
  log "[$out] clearing ./logs (active files truncated in place, rotated files deleted)"
  in_experiment 'find /logs -maxdepth 1 -type f -name "*.log" -exec truncate -s 0 {} + && find /logs -maxdepth 1 -type f ! -name "*.log" -delete'

  STEP="$out: experiment"
  log "[$out] running the experiment (${DURATION_MIN} min)"
  compose --profile experiment run --rm experiment \
    --duration-min "$DURATION_MIN" --warmup-min "$WARMUP_MIN" --rps "$RPS" --seed "$seed" --out "/results/$out"

  STEP="$out: copy logs"
  log "[$out] copying the logs to results/$out/logs"
  run sleep "$FLUSH_WAIT_S"
  in_experiment "mkdir -p /results/$out/logs && cp -a /logs/. /results/$out/logs/"

  STEP="$out: evaluate"
  log "[$out] evaluating"
  detector_cli evaluate --logs "/results/$out/logs" --labels "/results/$out/labels.csv" --out "/results/$out/detector"
done

first="${SEED_LIST[0]}"
second="${SEED_LIST[1]}"
runs=()
for seed in "${SEED_LIST[@]}"; do runs+=("/results/run_$seed"); done

STEP="aggregate"
log "aggregating ${#runs[@]} runs into results/summary"
detector_cli aggregate --runs "${runs[@]}" --out /results/summary

STEP="cross"
log "cross-run check: train on run_$first, test on run_$second"
detector_cli cross --train-run "/results/run_$first" --test-run "/results/run_$second" --out "/results/cross_${first}_${second}"

STEP="done"
log "Finished. Results: results/run_<seed>/detector, results/summary (stats.md, summary_q3.md), results/cross_${first}_${second}"
