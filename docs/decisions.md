# Design decisions

Choices made while extending the evaluation that the task description did not fix.
Each entry says what was decided and why, so it can be cited in the methodology chapter.

## Part 1 – Fair rule baseline

**D1. Three rule variants, and the default keeps its old name.** The variants are `rules`
(= *rules_default*, the original thresholds with `consecutive = 3`), `rules_tuned` and
`rules_tuned_k1`. The default keeps the key `rules` so that existing results files, the
`rules_detected` / `rules_delay_s` columns of `detection_delays.csv`, the live API, the
dashboard and `NOTIFY_METHODS` keep working. Its display label is now "Rule-based (default)".

**D2. Tuning objective: window-level F1 on the training windows.** The grid (81 combinations:
`consecutive` ∈ {1, 2, 3}, gateway 5xx ratio ∈ {0.02, 0.05, 0.10}, gateway p95 ∈ {1000, 2000,
3000} ms, ERROR lines per service ∈ {3, 5, 10}) is searched jointly, because the rules are
OR-combined: one threshold only makes sense given the others. `min_requests` (10) is not tuned:
it is a guard against tiny denominators, not a sensitivity setting.

**D3. Tie-breaking.** Best training F1; then fewer false-alarm episodes (an engineer prefers
the quieter alert at equal accuracy); then the first combination in grid order. Grid order
lists lower values first, so a remaining tie goes to the more sensitive setting. This is
deterministic and documented in `results.json → rule_tuning` (with the number of ties and the
ten best grid points).

**D4. Tuning uses training windows and their labels only.** The rules are fitted inside
`evaluate()` on the same training windows as the ML models, after the chronological split.
A test (`test_tuning_never_sees_test_labels`) removes every test-period fault from the labels
and checks that the chosen thresholds do not change.

**D5. `rules_tuned_k1` = the thresholds of `rules_tuned` with `consecutive = 1`.** It is not
a separate search restricted to k = 1. This isolates the effect of the `for:` duration: the
difference between `rules_tuned` and `rules_tuned_k1` is only the waiting time, so the Q3
comparison against it has no built-in delay. If the search already picks k = 1, both
variants are identical and the report shows that.

**D6. The tuned variants exist only in offline evaluation.** The live detector (API, alerts,
Telegram) keeps its three methods (`LIVE_METHODS`). The API's `POST /evaluate` keeps its
previous output by default and evaluates the tuned variants with `"tune_rules": true`; the CLI
`evaluate` command tunes by default and `--no-rule-tuning` restores the old three-method run.

**D7. The comparison table vs the default rules is unchanged.** `comparison_vs_rules` still
compares each ML model with `rules`; the new `comparison_vs_rule_variants` holds the same
comparison against every variant. Thesis conclusions for Q3 use the tuned variants.

**D8. Figure colours.** Colour follows the method: the three original methods keep their
colours; `rules_tuned` is yellow and `rules_tuned_k1` violet (reference palette slots 4 and 7).
Magenta (slot 5) was rejected because it is too close to Isolation Forest's orange for
normal vision (ΔE 12.9 < 15); the chosen set passes the palette validator.

**D9. Grid-edge check.** After tuning, every parameter whose chosen value is the smallest or
largest grid value is compared with its neighbour (the next value inward, other parameters
fixed). It is flagged in `results.json → rule_tuning.grid_edge` and in the report only if the
neighbour is worse (lower training F1, or equal F1 with more false-alarm episodes), because
only then may a better value lie outside the grid. Edges where the neighbour scores the same
are not flagged: there the tie-break picked the edge, the data did not. `consecutive = 1` is
never flagged, as it cannot go lower. The check only reports; it never extends the grid by
itself, so the search stays fixed in advance.

## Part 2 – Two more lightweight models

**D10. PCA score = squared prediction error (SPE)** in the log1p + standardised feature space,
using the components that explain 95 % of the variance of the **normal training windows**
(`svd_solver="full"`, deterministic). It uses the same symptom features as Isolation Forest, so
the two unsupervised models see identical inputs. If 95 % needs every component, the residual
would always be zero, so one component is dropped; this is logged as `n_components`.

**D11. PCA threshold = Isolation Forest's rule.** The 97th percentile of the training scores of
normal windows (the value is taken from `IsolationForestDetector`, so changing one changes
both). About 3 % of normal windows alert by construction for both unsupervised models.

**D12. Logistic Regression settings.** All window features (the same columns as Random Forest),
log1p + StandardScaler, `class_weight="balanced"`, `C = 1` (scikit-learn default, not tuned, in
line with the untuned 300-tree forests), `max_iter = 2000` so that lbfgs converges, threshold
0.5. The standardised coefficients (top 20 by size) are reported as its counterpart to Random
Forest's feature importance.

**D13. Method order and colours.** Methods are listed rules first, then Isolation Forest,
Random Forest, PCA, Logistic Regression: the original methods keep their position and colour,
and the new ones are appended. PCA is green and Logistic Regression magenta (reference palette
slots 6 and 5). The order and colours were chosen together so that every pair of neighbouring
bars passes the palette validator (colour-blind separation and normal-vision floor); placing
PCA directly after Isolation Forest fails it for every remaining hue.

**D14. Method selection.** `evaluate(methods=...)`, CLI `--methods` and the API's `methods`
field choose a subset; the default rules are always included because every comparison is made
against them. The CLI evaluates all seven methods by default. The API's `POST /evaluate` keeps
its previous three methods unless `methods` or `tune_rules` is given, and the live detector
(training, `/detect`, alerts, Telegram) is unchanged.

**D15. SciPy pinned to 1.14.1.** scikit-learn 1.5.2 with SciPy 1.18 warns about an unknown
lbfgs option in Logistic Regression; 1.14.1 is the release that matches the pinned scikit-learn.

## Part 3 – Aggregating several runs

**D16. Standard deviation over runs is the sample SD (ddof = 1).** The five runs are a sample of
possible experiments, not the whole population. With one run no SD is shown. A metric that is
undefined in a run (ROC-AUC without both classes) is left out of that method's mean, and the
`runs` column shows how many runs each method has.

**D17. Two kinds of summary, on purpose.** `summary_metrics` averages the per-run window metrics
(each run counts equally, whatever its number of windows). `summary_q3` **pools** the faults of
all runs (each fault counts equally), because a 3-hour run has only about 12 test-period faults,
too few for stable per-run delay statistics.

**D18. Fault identity is (run_id, fault_id).** Fault ids restart in every run (`F001`, …), so
`pooled_delays.csv` keeps `run_id`; the run id is the folder name (`run_3`).

**D19. Severity comes from the label's `params` JSON** (`{"severity": "low", …}`, written by the
experiment runner). Labels without it are grouped as `unknown`, never guessed.

**D20. Missing methods stay missing.** If a method was not evaluated in some run (e.g. an older
results folder, or `--methods`), its rows are absent for that run; they are not counted as
missed faults. Rule comparisons use only faults from runs where both methods were evaluated,
and the table states the number of faults compared.

**D21. Runs must share their evaluation settings.** `aggregate` refuses runs evaluated with a
different window, step, train fraction or grace period, because their metrics are not
comparable; re-run `evaluate` with the same options.

**D22. Earlier / same / later uses the existing per-fault rule** of `compare_with_rules`
(earlier = ML alerted first or only ML detected), applied to the pooled faults; this keeps the
single-run report and the summary consistent. Pooled counts equal the sum of the per-run counts
(tested).

## Part 4 – Statistical tests (`detector/stats.py`)

**D23. Clusters for the F1 bootstrap.** `evaluate` now also writes `window_predictions.csv`
(label, fault, cluster, score and alert of every method for every test window). A window's
cluster is the most recent fault that started before the window ended: the fault plus the
normal gap that follows it (windows before the first fault form a cluster `pre`). Resampling
these clusters keeps the strongly correlated neighbouring windows together and keeps each fault
with the false alarms that follow it, which window-level resampling would not.

**D24. Resampling is stratified by run.** Clusters (for F1) and faults (for delays) are
resampled with replacement inside each run, so every resample has the same mix of runs as the
data. All methods use the same resamples (paired). 2,000 resamples, seed 42, percentile
intervals. The F1 point estimate is the pooled F1 of all test windows (micro average), which
can differ slightly from the mean of per-run F1 in `summary_metrics.md`.

**D25. Fallback for older runs.** If a run has no `window_predictions.csv` (evaluated before
this change), the F1 interval resamples runs (mean of per-run F1) and the table says so.
Re-running `evaluate` restores the cluster bootstrap.

**D26. Mean-delay interval.** Faults are resampled within runs; the statistic is the mean
delay of the detected faults in the resample, so a change in the detection rate does not
masquerade as a change in delay.

**D27. McNemar, exact version.** Only discordant faults (detected by exactly one method)
carry information; the p-value is the two-sided binomial test of `ml_only` out of
`ml_only + rule_only` at 0.5. With fewer than 6 discordant faults the test is not run.

**D28. Wilcoxon details.** Differences are rule − ML (positive = ML earlier). Pairs with a
zero difference (both alerted on the same window) are dropped (Wilcoxon's original method), so
`n` is the number of non-zero pairs, and both `n` and the number of faults detected by both are
reported. Delays are multiples of the 10 s step, so ties are frequent and the exact
distribution does not apply; p and Z come from the normal approximation with tie correction and
no continuity correction. Effect size r = |Z| / √n (0.1 small, 0.3 medium, 0.5 large). With
fewer than 6 non-zero pairs the test is not run.

**D29. Which comparisons and Holm family.** Each ML model is compared with each tuned rule
variant (`rules_tuned`, `rules_tuned_k1`), for detection (McNemar) and delay (Wilcoxon); all
tests that were run form one Holm family. If `rules_tuned_k1` produced exactly the same
per-fault results as `rules_tuned` (the search already chose k = 1), its tests are exact
duplicates and are not repeated, so they do not inflate the correction; `stats.md` says so.

**D30. Hypothesis wording.** Delay tests are reported as H3₀ (no difference in detection
delay). Detection tests are reported as "H₀ (no difference in per-fault detection)", since the
thesis hypotheses do not name one; rename it in `stats.hypothesis_line` if needed.

## Part 5 – Cross-run generalisation (`detector.cli cross`)

**D31. One shared comparison routine.** `evaluate` (chronological split of one run) and
`cross` (one run trains, another tests) build their training and test windows differently and
then call the same `run_comparison`, so metrics, delays, rule tuning, comparisons, report and
figures are computed identically in both modes. The single-run outputs did not change.

**D32. Nothing of the test run is used for fitting.** The known-template vocabulary for
`unseen_templates` comes from the normal logs of the training run (outside fault windows),
the rules are tuned on the training run's windows, and every model is fitted on them. A test
removes test-run faults and checks that all thresholds and the tuned rules stay the same.

**D33. Whole runs, no split.** The training run uses all its windows, the test run all its
windows (nothing is dropped), and every fault of the test run is evaluated. Each run keeps its
own load period from its `experiment.json`.

**D34. Within-run reference.** If the test run already has its own evaluation
(`<test run>/detector/results.json`, same window length), the report puts its F1, false alarms
per hour and detection rate next to the cross-run values. The test windows differ (whole run
vs the last 40 %), so the table is for the size and direction of the change: a large F1 drop
for Random Forest would suggest it memorised its training run; more false alarms for
Isolation Forest or PCA indicate environment drift. A reference made with another window
length is ignored.

## Part 6 – Overnight script (`scripts/run_all_experiments.sh`)

**D35. Everything that touches `./logs` or `./results` runs in the project's containers.**
On Linux the containers write those folders as root, so host-side `rm`, `cp` or a host Python
writing into `results/run_N/` could fail with "permission denied". Clearing and copying logs
run in the experiment image; `evaluate`, `aggregate` and `cross` run in the `ml-detector`
image, which `docker compose up --build` rebuilds from the current code each time.

**D36. Clearing `./logs` truncates the active files instead of deleting them.** The services
keep `<service>.log` open in append mode; deleting it would make them write into an
unlinked file that no one can read. Truncating keeps the file, and appends continue at the
new end. Rotated archives (`*.log.gz`) of the previous run are deleted. Logs written before the
load starts are excluded anyway by the load period in `experiment.json`.

**D37. Locks.** The script refuses to start, and checks again before clearing the logs of
each run, while the experiment runner's lock `results/.experiment-running` exists. Its own lock
`.run-all-experiments.lock` sits in the repository root (not in `results/`, which Docker may
own) and stops a second copy of the script; it is removed when the script ends, also on error.

**D38. Restartable.** A seed whose run folder has `experiment.json` with `"completed": true`
and `detector/results.json` is skipped, so after a failure the script is simply started again.
A half-finished run folder stops the script instead of being overwritten; the user decides
whether to delete it.

**D39. The stack is not restarted between runs.** `docker compose up -d --build --wait` leaves
running containers alone, so runs 2–5 start with warm JVMs and a populated database (stock and
balances are refilled by the load generator every two minutes). The 10-minute warm-up and the
load-period filter keep start-up effects out of every run. Only run 1 may see a cold start.

**D40. Time estimate.** Printed before anything starts: runs × (experiment length + about 8 min
for start-up, health wait, log copy and evaluation) + about 10 min for aggregate and cross;
about 15 h 50 min for the default 5 × 180 min. `OVERHEAD_MIN` and `FINAL_MIN` adjust the
estimate only.

## Mobile app (`mobile/`)

**D41. One Flutter app with Monitor, Shop and Settings tabs, for Android and the web.** The
monitor mirrors the web dashboard (it uses the same ml-detector endpoints); the shop mirrors the
shop page (the same gateway endpoints). No backend endpoint was added for the app.

**D42. The app cannot spoil an experiment.** Shop requests are real traffic in the analysed
logs, so the Shop tab first asks the ml-detector whether an experiment holds the lock and, if
one does, sends no request to the gateway at all. Only the visible tab polls, and the app opens
on the Monitor tab. The monitor only calls the ml-detector, whose requests do not appear in the
analysed service logs (checked: a monitor poll adds no gateway access-log line), and its fault
button is disabled during an experiment, like the web dashboard's. The connection test uses only
the monitor. Tests assert that no gateway request is made in these cases.

**D43. CORS for the web build only.** A browser blocks calls from the web app's origin
(e.g. port 5000) to ports 8080 and 8000 unless the servers allow it. The gateway answers CORS
preflight requests for `/api/**` itself (GET and POST only), before routing, so preflights never
reach a service or the access log (tested). The ml-detector adds the same headers. Both allow
every origin by default (a local research setup) and can be restricted with
`CORS_ALLOWED_ORIGINS` / `CORS_ALLOW_ORIGINS`. Native Android requests are not affected by CORS.

**D44. Plain HTTP on the local network.** The system runs on the PC without TLS, so the Android
app allows cleartext traffic (`usesCleartextTraffic`). This is acceptable for a lab setup on a
private Wi-Fi; a deployment beyond that would need HTTPS.

**D45. Same colours as the thesis figures.** Each detector has the same colour in the app, the
web dashboard and the evaluation figures; status labels always carry an icon and a word, never
colour alone.
