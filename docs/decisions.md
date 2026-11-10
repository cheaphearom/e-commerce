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
