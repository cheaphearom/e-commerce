"""The three detectors compared in the thesis.

All share one interface:

    fit(X, y=None) -> self
    score(X) -> np.ndarray     higher = more anomalous (used for ROC-AUC)
    predict(X) -> np.ndarray   0/1 alert per window

``X`` is the window frame produced by :mod:`detector.features` (one row per window, columns
``window_start``, ``window_end`` and the ``<service>__<feature>`` / ``system__<feature>``
features).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from .features import SERVICES, feature_name, system_name

META_COLUMNS = ("window_start", "window_end", "label", "fault_id")


def model_feature_columns(frame: pd.DataFrame) -> list[str]:
    """Every feature column (anything named ``<scope>__<feature>``)."""
    return [c for c in frame.columns if "__" in c and c not in META_COLUMNS]


# ---------------------------------------------------------------------------------------
# Rule-based baseline
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True)
class RuleConfig:
    """Thresholds of the traditional monitoring rules (Prometheus-style alerts)."""

    gateway_5xx_ratio: float = 0.05     # > 5 % of gateway responses are 5xx
    gateway_p95_ms: float = 2000.0      # gateway p95 latency above 2 s
    errors_per_service: float = 10.0    # more than 10 ERROR lines in one service per window
    min_requests: int = 10              # 5xx ratio only evaluated with enough traffic
    consecutive: int = 3                # condition must hold for 3 consecutive windows ("for:")


class RuleBasedDetector:
    """Static threshold rules that must hold for ``consecutive`` windows in a row.

    The continuous score of a window is, over all rules, the maximum of
    ``min(value / threshold)`` across the last ``consecutive`` windows. The rule fires when that
    score exceeds 1, i.e. when every one of those windows is above the threshold.
    """

    name = "rules"
    label = "Rule-based"

    def __init__(self, config: RuleConfig | None = None, step: float = 10.0,
                 services: tuple[str, ...] = SERVICES):
        self.config = config or RuleConfig()
        self.step = step
        self.services = services

    def fit(self, X: pd.DataFrame, y: np.ndarray | None = None) -> "RuleBasedDetector":
        return self

    def rule_ratios(self, X: pd.DataFrame) -> pd.DataFrame:
        """Per window and rule: observed value divided by its threshold (> 1 = condition true)."""
        c = self.config
        gw = "api-gateway"
        ratios = {}
        http_n = _col(X, feature_name(gw, "http_count"))
        r5xx = _col(X, feature_name(gw, "http_5xx_ratio"))
        ratios["gateway_5xx_ratio"] = np.where(http_n >= c.min_requests, r5xx / c.gateway_5xx_ratio, 0.0)
        ratios["gateway_p95_latency"] = _col(X, feature_name(gw, "latency_p95")) / c.gateway_p95_ms
        for svc in self.services:
            ratios[f"errors_{svc}"] = _col(X, feature_name(svc, "error_count")) / c.errors_per_service
        return pd.DataFrame(ratios, index=X.index)

    def sustained_ratios(self, X: pd.DataFrame) -> pd.DataFrame:
        ratios = self.rule_ratios(X)
        starts = X["window_start"].to_numpy(dtype=float) if "window_start" in X else None
        return ratios.apply(lambda col: pd.Series(
            sustained_min(col.to_numpy(dtype=float), self.config.consecutive, starts, self.step),
            index=X.index))

    def score(self, X: pd.DataFrame) -> np.ndarray:
        if len(X) == 0:
            return np.zeros(0)
        return self.sustained_ratios(X).max(axis=1).to_numpy(dtype=float)

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return (self.score(X) > 1.0).astype(int)

    def fired_rules(self, X: pd.DataFrame) -> list[list[str]]:
        sustained = self.sustained_ratios(X)
        return [[name for name, v in row.items() if v > 1.0] for _, row in sustained.iterrows()]


def sustained_min(values: np.ndarray, k: int, starts: np.ndarray | None = None,
                  step: float = 10.0) -> np.ndarray:
    """Minimum of the last ``k`` consecutive values; 0 until ``k`` consecutive windows exist.

    A gap in ``starts`` (missing windows) resets the run, exactly like a Prometheus ``for:``
    clause that restarts when a sample is missing.
    """
    values = np.asarray(values, dtype=float)
    n = values.size
    out = np.zeros(n)
    if n == 0 or k <= 0:
        return out
    run_start = 0
    for i in range(n):
        if starts is not None and i > 0 and abs(starts[i] - starts[i - 1] - step) > step * 0.5:
            run_start = i
        if i - run_start + 1 >= k:
            out[i] = values[i - k + 1:i + 1].min()
    return out


def _col(X: pd.DataFrame, name: str) -> np.ndarray:
    if name in X:
        return X[name].to_numpy(dtype=float)
    return np.zeros(len(X))


# ---------------------------------------------------------------------------------------
# Isolation Forest (unsupervised, trained on normal windows only)
# ---------------------------------------------------------------------------------------
SYMPTOM_SERVICE_FEATURES = (
    "error_ratio", "error_count", "warn_count", "http_5xx", "http_5xx_ratio",
    "latency_mean", "latency_p95", "latency_max", "kafka_p95", "exception_count",
)
SYMPTOM_SYSTEM_FEATURES = ("saga_timeout", "saga_late_reply", "saga_success_ratio", "unseen_templates")


def symptom_columns(columns: list[str] | pd.Index, services: tuple[str, ...] = SERVICES) -> list[str]:
    """Symptom features: ratios, latencies and error counts - no raw traffic volume."""
    wanted = [feature_name(s, f) for s in services for f in SYMPTOM_SERVICE_FEATURES]
    wanted += [system_name(f) for f in SYMPTOM_SYSTEM_FEATURES]
    present = set(columns)
    return [c for c in wanted if c in present]


def _log1p_nonneg(x):
    return np.log1p(np.clip(np.asarray(x, dtype=float), 0.0, None))


class IsolationForestDetector:
    """log1p + StandardScaler + IsolationForest, fitted on normal windows only.

    The alert threshold is the ``percentile``-th percentile of the anomaly scores of the
    training windows, so about (100 - percentile) % of normal windows would alert.
    """

    name = "isolation_forest"
    label = "Isolation Forest"

    def __init__(self, n_estimators: int = 300, percentile: float = 97.0, random_state: int = 42):
        self.n_estimators = n_estimators
        self.percentile = percentile
        self.random_state = random_state
        self.columns_: list[str] = []
        self.threshold_: float = np.inf
        self.pipeline_: Pipeline | None = None

    def fit(self, X: pd.DataFrame, y: np.ndarray | None = None) -> "IsolationForestDetector":
        normal = X if y is None else X[np.asarray(y) == 0]
        if len(normal) < 10:
            raise ValueError(f"Isolation Forest needs at least 10 normal windows, got {len(normal)}")
        self.columns_ = symptom_columns(X.columns)
        self.pipeline_ = Pipeline([
            ("log1p", FunctionTransformer(_log1p_nonneg)),
            ("scale", StandardScaler()),
            ("forest", IsolationForest(n_estimators=self.n_estimators, contamination="auto",
                                       random_state=self.random_state, n_jobs=-1)),
        ])
        self.pipeline_.fit(normal[self.columns_].to_numpy(dtype=float))
        train_scores = self.score(normal)
        self.threshold_ = float(np.percentile(train_scores, self.percentile))
        return self

    def score(self, X: pd.DataFrame) -> np.ndarray:
        if self.pipeline_ is None:
            raise RuntimeError("IsolationForestDetector is not fitted")
        if len(X) == 0:
            return np.zeros(0)
        return -self.pipeline_.score_samples(X[self.columns_].to_numpy(dtype=float))

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return (self.score(X) > self.threshold_).astype(int)


# ---------------------------------------------------------------------------------------
# Random Forest (supervised)
# ---------------------------------------------------------------------------------------
class RandomForestDetector:
    """Supervised Random Forest on every window feature (300 trees, balanced class weights)."""

    name = "random_forest"
    label = "Random Forest"

    def __init__(self, n_estimators: int = 300, threshold: float = 0.5, random_state: int = 42):
        self.n_estimators = n_estimators
        self.threshold = threshold
        self.random_state = random_state
        self.columns_: list[str] = []
        self.model_: RandomForestClassifier | None = None

    def fit(self, X: pd.DataFrame, y: np.ndarray | None = None) -> "RandomForestDetector":
        if y is None:
            raise ValueError("Random Forest is supervised and needs labels")
        y = np.asarray(y, dtype=int)
        if np.unique(y).size < 2:
            raise ValueError("Random Forest needs both normal and anomalous windows in the training data")
        self.columns_ = model_feature_columns(X)
        self.model_ = RandomForestClassifier(n_estimators=self.n_estimators, class_weight="balanced",
                                             min_samples_leaf=2, random_state=self.random_state, n_jobs=-1)
        self.model_.fit(X[self.columns_].to_numpy(dtype=float), y)
        return self

    def score(self, X: pd.DataFrame) -> np.ndarray:
        if self.model_ is None:
            raise RuntimeError("RandomForestDetector is not fitted")
        if len(X) == 0:
            return np.zeros(0)
        return self.model_.predict_proba(X[self.columns_].to_numpy(dtype=float))[:, 1]

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return (self.score(X) >= self.threshold).astype(int)

    def feature_importance(self, top: int | None = None) -> list[tuple[str, float]]:
        if self.model_ is None:
            return []
        pairs = sorted(zip(self.columns_, self.model_.feature_importances_), key=lambda p: -p[1])
        pairs = [(name, float(v)) for name, v in pairs]
        return pairs[:top] if top else pairs


METHOD_ORDER = (RuleBasedDetector.name, IsolationForestDetector.name, RandomForestDetector.name)
METHOD_LABELS = {
    RuleBasedDetector.name: RuleBasedDetector.label,
    IsolationForestDetector.name: IsolationForestDetector.label,
    RandomForestDetector.name: RandomForestDetector.label,
}
