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
