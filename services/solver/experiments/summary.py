from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final

from app.core.types import (
    DomainInvariantError,
    require_finite,
    require_identifier,
    require_non_negative,
    require_probability,
)
from baselines.base import BaselineMethod
from experiments.metrics import RunMetrics
from experiments.runner import RunFailure, RunRecord
from experiments.stats import (
    DEFAULT_LEVEL,
    DEFAULT_RESAMPLES,
    KneePoint,
    RankCorrelation,
    SampleSummary,
    holm_adjust,
    knee_point,
    rank_correlation,
    signed_rank,
    summarize,
)

MIN_PAIRS: Final = 5
MIN_ELBOW_POINTS: Final = 3

DEFAULT_SUMMARY_METRICS: Final = (
    "adequacy",
    "dependability",
    "equity",
    "worst_sr",
    "shortage_total_m3",
    "cvar_shortage_m3",
    "solve_time_ms",
)

DEFAULT_PAIRWISE_METRICS: Final = (
    "shortage_total_m3",
    "cvar_shortage_m3",
    "worst_sr",
    "decision_regret",
)

METRIC_EXTRACTORS: Final[Mapping[str, Callable[[RunMetrics], float | None]]] = {
    "adequacy": lambda metrics: metrics.adequacy,
    "efficiency": lambda metrics: metrics.efficiency,
    "dependability": lambda metrics: metrics.dependability,
    "equity": lambda metrics: metrics.equity,
    "worst_sr": lambda metrics: metrics.worst_sr,
    "shortage_total_m3": lambda metrics: metrics.shortage_total_m3,
    "tail_deficit_m3": lambda metrics: metrics.tail_deficit_m3,
    "cvar_shortage_m3": lambda metrics: metrics.cvar_shortage_m3,
    "state_rmse": lambda metrics: metrics.state_rmse,
    "solve_time_ms": lambda metrics: metrics.solve_time_ms,
    "decision_regret": lambda metrics: metrics.decision_regret,
}

type PairingKey = tuple[int, tuple[str, ...]]


@dataclass(frozen=True, slots=True)
class MethodSummary:
    method: BaselineMethod
    runs: int
    failures: int
    fallback_rate: float
    metrics: Mapping[str, SampleSummary]

    def __post_init__(self) -> None:
        if not isinstance(self.method, BaselineMethod):
            raise DomainInvariantError("method must be a BaselineMethod")
        if isinstance(self.runs, bool) or not isinstance(self.runs, int) or self.runs < 0:
            raise DomainInvariantError("runs must be a non-negative integer")
        if (
            isinstance(self.failures, bool)
            or not isinstance(self.failures, int)
            or self.failures < 0
        ):
            raise DomainInvariantError("failures must be a non-negative integer")
        rate = require_finite(self.fallback_rate, "fallback_rate")
        if not 0.0 <= rate <= 1.0:
            raise DomainInvariantError("fallback_rate must lie in [0, 1]")
        for name, summary in self.metrics.items():
            require_identifier(name, "metric name")
            if not isinstance(summary, SampleSummary):
                raise DomainInvariantError("metric summaries must be SampleSummary")


@dataclass(frozen=True, slots=True)
class PairwiseTest:
    metric: str
    treatment: BaselineMethod
    control: BaselineMethod
    n_pairs: int
    statistic: float
    p_value: float
    p_adjusted: float
    rank_biserial: float

    def __post_init__(self) -> None:
        require_identifier(self.metric, "metric")
        if not isinstance(self.treatment, BaselineMethod) or not isinstance(
            self.control, BaselineMethod
        ):
            raise DomainInvariantError("treatment and control must be BaselineMethod")
        if self.treatment is self.control:
            raise DomainInvariantError("treatment and control must differ")
        if (
            isinstance(self.n_pairs, bool)
            or not isinstance(self.n_pairs, int)
            or self.n_pairs < 1
        ):
            raise DomainInvariantError("n_pairs must be a positive integer")
        require_non_negative(self.statistic, "statistic")
        require_probability(self.p_value, "p_value")
        require_probability(self.p_adjusted, "p_adjusted")
        effect = float(self.rank_biserial)
        if not -1.0 - 1.0e-9 <= effect <= 1.0 + 1.0e-9:
            raise DomainInvariantError("rank_biserial must lie in [-1, 1]")


@dataclass(frozen=True, slots=True)
class BudgetCurve:
    method: BaselineMethod
    metric: str
    sensor_counts: tuple[int, ...]
    means: tuple[float, ...]
    knee: KneePoint | None

    def __post_init__(self) -> None:
        if not isinstance(self.method, BaselineMethod):
            raise DomainInvariantError("method must be a BaselineMethod")
        require_identifier(self.metric, "metric")
        if not self.sensor_counts or len(self.sensor_counts) != len(self.means):
            raise DomainInvariantError("sensor_counts and means must share one length")
        for count in self.sensor_counts:
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise DomainInvariantError("sensor_counts must be non-negative integers")
        for value in self.means:
            if not math.isfinite(value):
                raise DomainInvariantError("means must be finite")
        if self.knee is not None and not isinstance(self.knee, KneePoint):
            raise DomainInvariantError("knee must be a KneePoint or None")


@dataclass(frozen=True, slots=True)
class ExperimentSummary:
    experiment_id: str
    config_hash: str
    level: float
    resamples: int
    seed: int
    failures_total: int
    methods: tuple[MethodSummary, ...]
    pairwise: tuple[PairwiseTest, ...]
    pairwise_excluded: int
    budget_curves: tuple[BudgetCurve, ...]

    def __post_init__(self) -> None:
        require_identifier(self.experiment_id, "experiment_id")
        require_identifier(self.config_hash, "config_hash")
        if not 0.0 < self.level < 1.0:
            raise DomainInvariantError("level must lie in (0, 1)")
        if (
            isinstance(self.resamples, bool)
            or not isinstance(self.resamples, int)
            or self.resamples < 1
        ):
            raise DomainInvariantError("resamples must be a positive integer")
        if isinstance(self.seed, bool) or not isinstance(self.seed, int) or self.seed < 0:
            raise DomainInvariantError("seed must be a non-negative integer")
        if (
            isinstance(self.failures_total, bool)
            or not isinstance(self.failures_total, int)
            or self.failures_total < 0
        ):
            raise DomainInvariantError("failures_total must be a non-negative integer")
        if (
            isinstance(self.pairwise_excluded, bool)
            or not isinstance(self.pairwise_excluded, int)
            or self.pairwise_excluded < 0
        ):
            raise DomainInvariantError("pairwise_excluded must be a non-negative integer")


def known_metrics() -> tuple[str, ...]:
    return tuple(sorted(METRIC_EXTRACTORS))


def metric_value(metric: str, metrics: RunMetrics) -> float | None:
    extractor = METRIC_EXTRACTORS.get(metric)
    if extractor is None:
        raise DomainInvariantError(
            f"unknown metric {metric!r}; known metrics: {known_metrics()}"
        )
    return extractor(metrics)


def _require_records(records: Sequence[RunRecord]) -> tuple[RunRecord, ...]:
    items = tuple(records)
    for record in items:
        if not isinstance(record, RunRecord):
            raise DomainInvariantError("records must contain RunRecord instances")
    return items


def _require_failures(failures: Sequence[RunFailure]) -> tuple[RunFailure, ...]:
    items = tuple(failures)
    for failure in items:
        if not isinstance(failure, RunFailure):
            raise DomainInvariantError("failures must contain RunFailure instances")
    return items


def _require_min_pairs(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise DomainInvariantError("min_pairs must be a positive integer")
    return value


def _require_seed(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DomainInvariantError("seed must be a non-negative integer")
    return value


def _pairing_key(record: RunRecord) -> PairingKey:
    return (record.spec.seed, record.spec.sensor_set)


def attach_decision_regret(records: Sequence[RunRecord]) -> tuple[RunRecord, ...]:
    items = _require_records(records)
    oracle_shortage: dict[PairingKey, float] = {}
    for record in items:
        if record.spec.method is not BaselineMethod.ORACLE:
            continue
        key = _pairing_key(record)
        if key in oracle_shortage:
            raise DomainInvariantError("duplicate oracle run for one environment")
        oracle_shortage[key] = record.metrics.shortage_total_m3
    if not oracle_shortage:
        return items
    enriched: list[RunRecord] = []
    for record in items:
        if (
            record.spec.method is BaselineMethod.ORACLE
            or record.metrics.decision_regret is not None
        ):
            enriched.append(record)
            continue
        reference = oracle_shortage.get(_pairing_key(record))
        if reference is None:
            enriched.append(record)
            continue
        enriched.append(
            replace(
                record,
                metrics=replace(
                    record.metrics,
                    decision_regret=record.metrics.shortage_total_m3 - reference,
                ),
            )
        )
    return tuple(enriched)


def _keyed_records(records: tuple[RunRecord, ...]) -> dict[PairingKey, RunRecord]:
    grouped: dict[PairingKey, list[RunRecord]] = {}
    for record in records:
        grouped.setdefault(_pairing_key(record), []).append(record)
    return {key: items[0] for key, items in grouped.items() if len(items) == 1}


def _metric_series(records: tuple[RunRecord, ...], metric: str) -> tuple[float, ...]:
    values: list[float] = []
    for record in records:
        value = metric_value(metric, record.metrics)
        if value is not None:
            values.append(value)
    return tuple(values)


def _method_summary(
    method: BaselineMethod,
    records: tuple[RunRecord, ...],
    failures: tuple[RunFailure, ...],
    *,
    metrics: Sequence[str],
    level: float,
    resamples: int,
    seed: int,
) -> MethodSummary:
    runs = len(records)
    fallback_count = sum(1 for record in records if record.metrics.fallback_used)
    summaries: dict[str, SampleSummary] = {}
    for metric in metrics:
        values = _metric_series(records, metric)
        if not values:
            continue
        summaries[metric] = summarize(values, level=level, resamples=resamples, seed=seed)
    return MethodSummary(
        method=method,
        runs=runs,
        failures=len(failures),
        fallback_rate=(fallback_count / runs) if runs else 0.0,
        metrics=summaries,
    )


def _paired_series(
    left: Mapping[PairingKey, RunRecord],
    right: Mapping[PairingKey, RunRecord],
    metric: str,
) -> tuple[tuple[float, float], ...]:
    pairs: list[tuple[float, float]] = []
    for key in sorted(set(left) & set(right)):
        first = metric_value(metric, left[key].metrics)
        second = metric_value(metric, right[key].metrics)
        if first is None or second is None:
            continue
        pairs.append((first, second))
    return tuple(pairs)


def build_pairwise_tests(
    records: Sequence[RunRecord],
    *,
    metrics: Sequence[str] = DEFAULT_PAIRWISE_METRICS,
    min_pairs: int = MIN_PAIRS,
) -> tuple[tuple[PairwiseTest, ...], int]:
    items = _require_records(records)
    threshold = _require_min_pairs(min_pairs)
    by_method: dict[BaselineMethod, dict[PairingKey, RunRecord]] = {}
    for method in BaselineMethod:
        selected = tuple(record for record in items if record.spec.method is method)
        if selected:
            by_method[method] = _keyed_records(selected)
    present = [method for method in BaselineMethod if method in by_method]
    tests: list[PairwiseTest] = []
    excluded = 0
    for metric in metrics:
        metric_tests: list[PairwiseTest] = []
        for position, treatment in enumerate(present):
            for control in present[position + 1 :]:
                pairs = _paired_series(by_method[treatment], by_method[control], metric)
                if len(pairs) < threshold:
                    excluded += 1
                    continue
                differences = tuple(left - right for left, right in pairs)
                outcome = signed_rank(differences)
                metric_tests.append(
                    PairwiseTest(
                        metric=metric,
                        treatment=treatment,
                        control=control,
                        n_pairs=len(pairs),
                        statistic=outcome.statistic,
                        p_value=outcome.p_value,
                        p_adjusted=outcome.p_value,
                        rank_biserial=outcome.rank_biserial,
                    )
                )
        adjusted = holm_adjust([test.p_value for test in metric_tests])
        tests.extend(
            replace(test, p_adjusted=adjusted[index])
            for index, test in enumerate(metric_tests)
        )
    return tuple(tests), excluded


def build_budget_curve(
    records: Sequence[RunRecord],
    *,
    method: BaselineMethod,
    metric: str,
) -> BudgetCurve:
    if not isinstance(method, BaselineMethod):
        raise DomainInvariantError("method must be a BaselineMethod")
    items = _require_records(records)
    metric_value(metric, items[0].metrics) if items else None
    grouped: dict[int, list[float]] = {}
    for record in items:
        if record.spec.method is not method:
            continue
        value = metric_value(metric, record.metrics)
        if value is None:
            continue
        grouped.setdefault(record.spec.sensor_count, []).append(value)
    if not grouped:
        raise DomainInvariantError(
            "no records with the requested metric for this method"
        )
    counts = tuple(sorted(grouped))
    means = tuple(math.fsum(grouped[count]) / len(grouped[count]) for count in counts)
    knee = knee_point(counts, means) if len(counts) >= MIN_ELBOW_POINTS else None
    return BudgetCurve(
        method=method,
        metric=metric,
        sensor_counts=counts,
        means=means,
        knee=knee,
    )


def metric_rank_correlation(
    records: Sequence[RunRecord],
    first_metric: str,
    second_metric: str,
) -> RankCorrelation:
    items = _require_records(records)
    first_values: list[float] = []
    second_values: list[float] = []
    for record in items:
        first = metric_value(first_metric, record.metrics)
        second = metric_value(second_metric, record.metrics)
        if first is None or second is None:
            continue
        first_values.append(first)
        second_values.append(second)
    return rank_correlation(first_values, second_values)


def build_summary(
    records: Sequence[RunRecord],
    failures: Sequence[RunFailure] = (),
    *,
    experiment_id: str,
    plan_hash: str,
    seed: int,
    level: float = DEFAULT_LEVEL,
    resamples: int = DEFAULT_RESAMPLES,
    metrics: Sequence[str] = DEFAULT_SUMMARY_METRICS,
    pairwise_metrics: Sequence[str] = DEFAULT_PAIRWISE_METRICS,
    min_pairs: int = MIN_PAIRS,
    budget_curves: Sequence[BudgetCurve] = (),
) -> ExperimentSummary:
    items = _require_records(records)
    fails = _require_failures(failures)
    require_identifier(experiment_id, "experiment_id")
    require_identifier(plan_hash, "plan_hash")
    _require_seed(seed)
    method_summaries: list[MethodSummary] = []
    for method in BaselineMethod:
        method_records = tuple(
            record for record in items if record.spec.method is method
        )
        method_failures = tuple(
            failure for failure in fails if failure.spec.method is method
        )
        if not method_records and not method_failures:
            continue
        method_summaries.append(
            _method_summary(
                method,
                method_records,
                method_failures,
                metrics=metrics,
                level=level,
                resamples=resamples,
                seed=seed,
            )
        )
    pairwise, excluded = build_pairwise_tests(
        items, metrics=pairwise_metrics, min_pairs=min_pairs
    )
    return ExperimentSummary(
        experiment_id=experiment_id,
        config_hash=plan_hash,
        level=level,
        resamples=resamples,
        seed=seed,
        failures_total=len(fails),
        methods=tuple(method_summaries),
        pairwise=pairwise,
        pairwise_excluded=excluded,
        budget_curves=tuple(budget_curves),
    )
