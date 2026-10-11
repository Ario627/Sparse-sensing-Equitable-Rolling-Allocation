"""Visualisasi hasil eksperimen SERA.

Modul ini membaca artefak yang sudah ditulis `reporting.write_experiment_report`
(`runs.parquet`, `summary.json`, `timeseries/`) dan menghasilkan PNG. Tidak ada
perhitungan metrik di sini: angka yang digambar selalu berasal dari artefak, agar
chart dan laporan tidak pernah berbeda sumber.

Aturan pelaporan `docs/SERA_v3_08_EKSPERIMEN_KPI.md` §5.4 dipatuhi:

1. Setiap KPI digambar dengan interval (error bar CI dari `summary.json`).
2. Jumlah run (`n`) dicetak di chart.
3. Oracle selalu ditandai sebagai *upper bound*, bukan kompetitor.

Agregasi memakai Python biasa, bukan `DataFrame.groupby`, supaya tipe data tetap
eksplisit dan lolos `pyright` mode strict.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.axes import Axes
from matplotlib.figure import Figure

from sera.core.io import experiment_dir
from sera.core.types import DomainInvariantError, require_identifier
from sera.experiments.reporting import (
    META_FILENAME,
    RUNS_FILENAME,
    SUMMARY_FILENAME,
)

TIMESERIES_DIRNAME: Final = "timeseries"
DPI: Final = 140
FIGURE_WIDTH: Final = 16.0
KPI_COLUMNS: Final = 3
SERA_COLOR: Final = "#1b4965"
ORACLE_COLOR: Final = "#8d99ae"
BASELINE_COLORS: Final[Mapping[str, str]] = {
    "proportional": "#e07a5f",
    "rotation": "#f2cc8f",
    "greedy": "#81b29a",
}
FALLBACK_COLOR: Final = "#6c757d"
INDEX_FILENAME: Final = "charts.json"
TIME_COLUMN: Final = "ts"

# True = makin besar makin baik.
METRIC_DIRECTION: Final[Mapping[str, bool]] = {
    "adequacy": True,
    "efficiency": True,
    "dependability": True,
    "equity": False,
    "worst_sr": True,
    "shortage_total_m3": False,
    "tail_deficit_m3": False,
    "cvar_shortage_m3": False,
    "state_rmse": False,
    "solve_time_ms": False,
    "decision_regret": False,
}

METRIC_LABEL: Final[Mapping[str, str]] = {
    "adequacy": "Adequacy (delivered/required)",
    "efficiency": "Efficiency (delivered/gross)",
    "dependability": "Dependability (slot terpenuhi)",
    "equity": "Equity (Gini SR, rendah = merata)",
    "worst_sr": "Worst service ratio (min SR)",
    "shortage_total_m3": "Total shortage (m3)",
    "tail_deficit_m3": "Tail deficit (m3)",
    "cvar_shortage_m3": "CVaR shortage (m3)",
    "state_rmse": "State RMSE (mm)",
    "solve_time_ms": "Solve time (ms)",
    "decision_regret": "Decision regret vs oracle",
}

# KPI kualitas keputusan untuk scorecard final. Solve time SENGAJA tidak ikut
# dirata-ratakan: baseline heuristik selalu 0 ms, sehingga mencampurnya membuat
# metode sepele tampak unggul. Biaya dilaporkan terpisah di panel ketiga.
SCORECARD_METRICS: Final[tuple[str, ...]] = (
    "adequacy",
    "dependability",
    "worst_sr",
    "shortage_total_m3",
    "cvar_shortage_m3",
    "decision_regret",
)

SWEEP_METRICS: Final[tuple[str, ...]] = (
    "adequacy",
    "shortage_total_m3",
    "worst_sr",
    "equity",
)

FACTOR_COLUMNS: Final[tuple[str, ...]] = (
    "k_factor",
    "n_blocks",
    "sensor_count",
    "topology",
    "scenario_id",
)


def _text(value: object) -> str:
    return value if isinstance(value, str) else str(value)


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) else None


def _rows(frame: pd.DataFrame) -> tuple[Mapping[str, object], ...]:
    return tuple(
        {str(key): value for key, value in row.items()}
        for row in frame.to_dict(orient="records")
    )


def _mean(values: Sequence[float]) -> float:
    return math.fsum(values) / len(values)


def _standard_error(values: Sequence[float]) -> float:
    if len(values) < 2:
        return 0.0
    average = _mean(values)
    variance = math.fsum((value - average) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance / len(values))


@dataclass(frozen=True, slots=True)
class ExperimentArtifacts:
    """Artefak satu eksperimen yang sudah dibaca dari disk."""

    experiment_id: str
    directory: Path
    runs: pd.DataFrame
    summary: Mapping[str, object]
    timeseries_files: tuple[Path, ...]
    meta: Mapping[str, object]

    @property
    def methods(self) -> tuple[str, ...]:
        return tuple(sorted(_text(value) for value in self.runs["method"].unique()))

    @property
    def timeseries_available(self) -> bool:
        return len(self.timeseries_files) > 0


def load_artifacts(results_root: Path, experiment_id: str) -> ExperimentArtifacts:
    """Baca runs.parquet + summary.json + daftar timeseries sebuah eksperimen."""
    identifier = require_identifier(experiment_id, "experiment_id")
    directory = experiment_dir(results_root, identifier)
    runs_path = directory / RUNS_FILENAME
    summary_path = directory / SUMMARY_FILENAME
    if not runs_path.is_file():
        raise DomainInvariantError(f"missing runs artifact: {runs_path}")
    if not summary_path.is_file():
        raise DomainInvariantError(f"missing summary artifact: {summary_path}")
    runs = pd.read_parquet(runs_path)
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if not isinstance(summary, dict):
        raise DomainInvariantError("summary.json must contain an object")
    meta_path = directory / META_FILENAME
    meta: Mapping[str, object] = (
        json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    )
    timeseries_dir = directory / TIMESERIES_DIRNAME
    files = tuple(sorted(timeseries_dir.rglob("*.parquet"))) if timeseries_dir.is_dir() else ()
    return ExperimentArtifacts(
        experiment_id=identifier,
        directory=directory,
        runs=runs,
        summary=summary,
        timeseries_files=files,
        meta=meta,
    )


def method_color(method: str) -> str:
    if method == "sera":
        return SERA_COLOR
    if method == "oracle":
        return ORACLE_COLOR
    return BASELINE_COLORS.get(method, FALLBACK_COLOR)


def _method_summaries(summary: Mapping[str, object]) -> tuple[Mapping[str, object], ...]:
    raw = summary.get("methods")
    if not isinstance(raw, list):
        raise DomainInvariantError("summary.methods must be a list")
    items: list[Mapping[str, object]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise DomainInvariantError("summary.methods entries must be objects")
        items.append(entry)
    return tuple(items)


def _sample(entry: Mapping[str, object], metric: str) -> Mapping[str, object] | None:
    metrics = entry.get("metrics")
    if not isinstance(metrics, dict):
        return None
    value = metrics.get(metric)
    return value if isinstance(value, dict) else None


def _metric_mean(entry: Mapping[str, object], metric: str) -> float | None:
    sample = _sample(entry, metric)
    return None if sample is None else _number(sample.get("mean"))


def _metric_ci(entry: Mapping[str, object], metric: str) -> tuple[float, float] | None:
    sample = _sample(entry, metric)
    if sample is None:
        return None
    ci = sample.get("ci")
    if not isinstance(ci, dict):
        return None
    lower = _number(ci.get("lower"))
    upper = _number(ci.get("upper"))
    return None if lower is None or upper is None else (lower, upper)


def _entry_for(entries: Sequence[Mapping[str, object]], method: str) -> Mapping[str, object] | None:
    for entry in entries:
        if _text(entry.get("method", "")) == method:
            return entry
    return None


def _ordered_methods(entries: Sequence[Mapping[str, object]]) -> tuple[str, ...]:
    names = {_text(entry.get("method", "")) for entry in entries}
    preferred = ("sera", "proportional", "rotation", "greedy", "oracle")
    ordered = [name for name in preferred if name in names]
    ordered.extend(sorted(names - set(ordered) - {""}))
    return tuple(ordered)


def _annotate(axis: Axes, text: str, *, size: float = 8.0, y: float = 0.97) -> None:
    axis.text(
        0.99,
        y,
        text,
        transform=axis.transAxes,
        ha="right",
        va="top",
        fontsize=size,
        color="#495057",
    )


def _save(figure: Figure, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.tight_layout()
    figure.savefig(str(path), dpi=DPI)
    plt.close(figure)
    return path


def chart_kpi_comparison(
    artifacts: ExperimentArtifacts, out_dir: Path
) -> tuple[Path, tuple[str, ...]]:
    """Grid bar per KPI: mean + CI, oracle sebagai garis referensi."""
    entries = _method_summaries(artifacts.summary)
    metrics = [
        metric
        for metric in METRIC_LABEL
        if any(_metric_mean(entry, metric) is not None for entry in entries)
    ]
    if not metrics:
        raise DomainInvariantError("no metric available to plot")
    rows = (len(metrics) + KPI_COLUMNS - 1) // KPI_COLUMNS
    figure, axes = plt.subplots(
        rows, KPI_COLUMNS, figsize=(FIGURE_WIDTH, 3.6 * rows), squeeze=False
    )
    flat = list(axes.flat)
    total_runs = 0
    for entry in entries:
        runs = _number(entry.get("runs"))
        if runs is not None:
            total_runs += int(runs)
    methods = _ordered_methods(entries)
    for axis, metric in zip(flat, metrics, strict=False):
        positions = list(range(len(methods)))
        means: list[float] = []
        errors: list[tuple[float, float]] = []
        for method in methods:
            entry = _entry_for(entries, method)
            mean = 0.0 if entry is None else (_metric_mean(entry, metric) or 0.0)
            ci = None if entry is None else _metric_ci(entry, metric)
            means.append(mean)
            errors.append((0.0, 0.0) if ci is None else (mean - ci[0], ci[1] - mean))
        axis.bar(
            positions,
            means,
            color=[method_color(method) for method in methods],
            edgecolor="#212529",
            linewidth=0.6,
        )
        if any(low > 0.0 or high > 0.0 for low, high in errors):
            axis.errorbar(
                positions,
                means,
                yerr=[[low for low, _ in errors], [high for _, high in errors]],
                fmt="none",
                ecolor="#212529",
                capsize=3,
                linewidth=1.0,
            )
        oracle = _entry_for(entries, "oracle")
        oracle_mean = None if oracle is None else _metric_mean(oracle, metric)
        if oracle_mean is not None:
            axis.axhline(
                oracle_mean,
                color=ORACLE_COLOR,
                linestyle="--",
                linewidth=1.2,
                label="oracle (upper bound)",
            )
        axis.set_xticks(positions)
        axis.set_xticklabels(methods, rotation=30, ha="right", fontsize=8)
        direction = (
            "tinggi lebih baik" if METRIC_DIRECTION.get(metric, True) else "rendah lebih baik"
        )
        axis.set_title(f"{METRIC_LABEL.get(metric, metric)}\n({direction})", fontsize=9)
        axis.grid(axis="y", alpha=0.3)
        _annotate(axis, f"n={total_runs} run")
    for axis in flat[len(metrics) :]:
        axis.axis("off")
    figure.suptitle(f"KPI per metode — {artifacts.experiment_id}", fontsize=13, y=1.0)
    return _save(figure, out_dir / "kpi_comparison.png"), tuple(metrics)


def _is_varying(frame: pd.DataFrame, column: str) -> bool:
    series = frame[column]
    if not isinstance(series, pd.Series):
        return True
    values = series.to_numpy()
    return bool((values != values[0]).any())


@dataclass(frozen=True, slots=True)
class _FactorPoint:
    label: str
    mean: float
    sem: float
    count: int


def _factor_series(
    rows: Sequence[Mapping[str, object]], factor: str, method: str, metric: str
) -> tuple[_FactorPoint, ...]:
    buckets: dict[str, list[float]] = {}
    for row in rows:
        if _text(row.get("method")) != method:
            continue
        value = _number(row.get(metric))
        if value is None:
            continue
        buckets.setdefault(_text(row.get(factor)), []).append(value)
    return tuple(
        _FactorPoint(
            label=label,
            mean=_mean(values),
            sem=_standard_error(values),
            count=len(values),
        )
        for label, values in sorted(buckets.items())
    )


def chart_factor_sweeps(artifacts: ExperimentArtifacts, out_dir: Path) -> tuple[Path, ...]:
    """Garis KPI terhadap tiap faktor yang bervariasi di grid."""
    frame = artifacts.runs
    rows = _rows(frame)
    varying = [
        column
        for column in FACTOR_COLUMNS
        if column in frame.columns and _is_varying(frame, column)
    ]
    metrics = [metric for metric in SWEEP_METRICS if metric in frame.columns]
    if not varying or not metrics:
        return ()
    methods = sorted(_text(value) for value in frame["method"].unique())
    paths: list[Path] = []
    for factor in varying:
        figure, axes = plt.subplots(1, len(metrics), figsize=(FIGURE_WIDTH, 3.4), squeeze=False)
        for axis, metric in zip(axes[0], metrics, strict=True):
            for method in methods:
                series = _factor_series(rows, factor, method, metric)
                if not series:
                    continue
                axis.errorbar(
                    [point.label for point in series],
                    [point.mean for point in series],
                    yerr=[point.sem for point in series],
                    marker="o",
                    capsize=3,
                    linewidth=1.6,
                    color=method_color(method),
                    label=method,
                )
            direction = (
                "tinggi lebih baik" if METRIC_DIRECTION.get(metric, True) else "rendah lebih baik"
            )
            axis.set_title(f"{metric} ({direction})", fontsize=9)
            axis.set_xlabel(factor, fontsize=8)
            axis.grid(alpha=0.3)
            axis.tick_params(axis="x", labelrotation=20, labelsize=8)
        axes[0][0].legend(fontsize=7, loc="best")
        figure.suptitle(f"KPI terhadap {factor} — {artifacts.experiment_id}", fontsize=12)
        paths.append(_save(figure, out_dir / f"sweep_{factor}.png"))
    return tuple(paths)


def _timeseries_for_method(artifacts: ExperimentArtifacts, method: str) -> tuple[pd.DataFrame, ...]:
    return tuple(
        pd.read_parquet(path)
        for path in artifacts.timeseries_files
        if f"method={method}" in str(path)
    )


def _parse_stamp(value: object) -> datetime | None:
    """Normalisasi cap waktu menjadi datetime agar sumbu-x diformat matplotlib."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _numeric_for_plot(value: object) -> float | None:
    """Angka untuk plot; boolean dipetakan ke 0/1 (mis. `gate_open`)."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    return _number(value)


def _mean_by_time(
    frames: Sequence[pd.DataFrame], column: str
) -> tuple[tuple[datetime, float], ...]:
    buckets: dict[datetime, list[float]] = {}
    for frame in frames:
        if column not in frame.columns or TIME_COLUMN not in frame.columns:
            continue
        for row in _rows(frame):
            stamp = _parse_stamp(row.get(TIME_COLUMN))
            value = _numeric_for_plot(row.get(column))
            if stamp is None or value is None:
                continue
            buckets.setdefault(stamp, []).append(value)
    return tuple((stamp, _mean(values)) for stamp, values in sorted(buckets.items()))


def _series_methods(artifacts: ExperimentArtifacts) -> tuple[str, ...]:
    return tuple(
        method for method in artifacts.methods if len(_timeseries_for_method(artifacts, method)) > 0
    )


def chart_estimation_learning(artifacts: ExperimentArtifacts, out_dir: Path) -> Path | None:
    """Kurva 'belajar': eta_est mengejar eta_true, plus trajektori storage.

    Ini analog kurva training: sumbu-x waktu, sumbu-y seberapa dekat estimasi
    loss (`eta`) terhadap nilai benar simulator.
    """
    if not artifacts.timeseries_available:
        return None
    methods = _series_methods(artifacts)
    if not methods:
        return None
    figure, axes = plt.subplots(2, 1, figsize=(FIGURE_WIDTH, 7.2), sharex=True)
    eta_axis, storage_axis = axes
    truth_drawn = False
    for method in methods:
        frames = _timeseries_for_method(artifacts, method)
        estimate = _mean_by_time(frames, "eta_est")
        if not estimate:
            continue
        if not truth_drawn:
            truth = _mean_by_time(frames, "eta_true")
            if truth:
                eta_axis.plot(
                    [stamp for stamp, _ in truth],
                    [value for _, value in truth],
                    color="#212529",
                    linewidth=2.2,
                    linestyle="--",
                    label="eta_true (simulator)",
                    zorder=5,
                )
                truth_drawn = True
        eta_axis.plot(
            [stamp for stamp, _ in estimate],
            [value for _, value in estimate],
            color=method_color(method),
            linewidth=1.5,
            label=f"{method}: eta_est",
        )
        storage = _mean_by_time(frames, "storage_mm")
        if storage:
            storage_axis.plot(
                [stamp for stamp, _ in storage],
                [value for _, value in storage],
                color=method_color(method),
                linewidth=1.4,
                label=f"{method}: storage",
            )
    eta_axis.set_ylabel("eta (efisiensi ruas)", fontsize=9)
    eta_axis.set_title("Estimasi loss mengejar nilai benar (analog kurva training)", fontsize=10)
    eta_axis.legend(fontsize=7, ncol=2)
    eta_axis.grid(alpha=0.3)
    storage_axis.set_ylabel("storage rata-rata (mm)", fontsize=9)
    storage_axis.set_xlabel("waktu", fontsize=9)
    storage_axis.set_title("Trajektori storage rata-rata lintas blok", fontsize=10)
    storage_axis.legend(fontsize=7, ncol=2)
    storage_axis.grid(alpha=0.3)
    figure.suptitle(f"Pembelajaran estimator — {artifacts.experiment_id}", fontsize=13)
    return _save(figure, out_dir / "estimation_learning.png")


def chart_service_trajectories(artifacts: ExperimentArtifacts, out_dir: Path) -> Path | None:
    """Service ratio, debt ledger, dan aktivitas gate per metode."""
    if not artifacts.timeseries_available:
        return None
    methods = _series_methods(artifacts)
    if not methods:
        return None
    figure, axes = plt.subplots(3, 1, figsize=(FIGURE_WIDTH, 9.0), sharex=True)
    panels = (
        (
            axes[0],
            "service_ratio",
            "service ratio rata-rata",
            "Service ratio per waktu (1.0 = target terpenuhi)",
        ),
        (axes[1], "debt_m3", "debt ledger (m3)", "Akumulasi debt — memori layanan tiap blok"),
        (axes[2], "gate_open", "fraksi gate terbuka", "Aktivitas gate (biaya aktuasi)"),
    )
    for method in methods:
        frames = _timeseries_for_method(artifacts, method)
        for axis, column, _, _ in panels:
            series = _mean_by_time(frames, column)
            if not series:
                continue
            axis.plot(
                [stamp for stamp, _ in series],
                [value for _, value in series],
                color=method_color(method),
                linewidth=1.4,
                label=method,
            )
    for axis, column, ylabel, title in panels:
        axis.set_ylabel(ylabel, fontsize=9)
        axis.set_title(title, fontsize=10)
        axis.grid(alpha=0.3)
        handles, _ = axis.get_legend_handles_labels()
        if handles:
            axis.legend(fontsize=7, ncol=3)
        # Baseline loop terbuka tidak merekam besaran ini; katakan eksplisit
        # daripada membuat pembaca mengira datanya hilang.
        missing = [
            method
            for method in methods
            if not _mean_by_time(_timeseries_for_method(artifacts, method), column)
        ]
        if missing:
            _annotate(axis, f"tidak terekam: {', '.join(missing)}", size=7.5)
    axes[2].set_xlabel("waktu", fontsize=9)
    figure.suptitle(f"Trajektori layanan — {artifacts.experiment_id}", fontsize=13)
    return _save(figure, out_dir / "service_trajectories.png")


def _normalized_scores(
    entries: Sequence[Mapping[str, object]], metrics: Sequence[str]
) -> dict[str, dict[str, float]]:
    """Skor 0..1 per metode per metrik (1 = terbaik di antara metode yang digambar)."""
    scores: dict[str, dict[str, float]] = {}
    for metric in metrics:
        numeric: dict[str, float] = {}
        for entry in entries:
            value = _metric_mean(entry, metric)
            if value is not None:
                numeric[_text(entry.get("method"))] = value
        if not numeric:
            continue
        low = min(numeric.values())
        high = max(numeric.values())
        higher_is_better = METRIC_DIRECTION.get(metric, True)
        for method, value in numeric.items():
            if high - low < 1e-12:
                score = 1.0
            elif higher_is_better:
                score = (value - low) / (high - low)
            else:
                score = (high - value) / (high - low)
            scores.setdefault(method, {})[metric] = score
    return scores


def chart_final_scorecard(
    artifacts: ExperimentArtifacts, out_dir: Path
) -> tuple[Path, Mapping[str, object]]:
    """Chart final: peringkat komposit SERA vs metode lain, profil KPI, dan biaya.

    Skor dinormalisasi min-max antar metode untuk tiap KPI kualitas, lalu
    dirata-ratakan. Oracle digambar sebagai batas atas, bukan peserta peringkat.
    """
    entries = _method_summaries(artifacts.summary)
    metrics = [
        metric
        for metric in SCORECARD_METRICS
        if any(_metric_mean(entry, metric) is not None for entry in entries)
    ]
    if not metrics:
        raise DomainInvariantError("no scorecard metric available")
    scores = _normalized_scores(entries, metrics)
    # Oracle tidak pernah masuk peringkat: `decision_regret` tidak berlaku bagi
    # dirinya sendiri, sehingga jumlah KPI-nya selalu lebih sedikit dan
    # perbandingan skornya tidak apple-to-apple. Sesuai
    # docs/SERA_v3_08_EKSPERIMEN_KPI.md §2, oracle adalah batas atas.
    ordered = _ordered_methods(entries)
    competitors = [
        (method, math.fsum(scores[method].values()) / len(scores[method]), len(scores[method]))
        for method in ordered
        if method != "oracle" and method in scores and scores[method]
    ]
    competitors.sort(key=lambda item: (-item[1], item[0]))
    oracle_row = next(
        (
            (
                "oracle",
                math.fsum(scores["oracle"].values()) / len(scores["oracle"]),
                len(scores["oracle"]),
            )
            for _ in (0,)
            if scores.get("oracle")
        ),
        None,
    )
    labels = [method for method, _, _ in competitors]
    composite = [score for _, score, _ in competitors]
    if oracle_row is not None:
        labels.append(oracle_row[0])
        composite.append(oracle_row[1])
    ranked = [*competitors, *([oracle_row] if oracle_row is not None else [])]

    figure = plt.figure(figsize=(FIGURE_WIDTH, 6.6))
    bar_axis = figure.add_subplot(1, 3, 1)
    radar_axis = figure.add_subplot(1, 3, 2, projection="polar")
    cost_axis = figure.add_subplot(1, 3, 3)

    bars = bar_axis.barh(
        labels[::-1],
        composite[::-1],
        color=[method_color(method) for method in labels][::-1],
        edgecolor="#212529",
        linewidth=0.6,
        hatch=["//" if method == "oracle" else "" for method in labels][::-1],
    )
    for bar, (method, score, count) in zip(bars, ranked[::-1], strict=True):
        tag = " (referensi)" if method == "oracle" else ""
        bar_axis.text(
            bar.get_width() + 0.012,
            bar.get_y() + bar.get_height() / 2,
            f"{score:.3f} ({count} KPI){tag}",
            va="center",
            fontsize=8,
        )
    bar_axis.set_xlim(0.0, 1.16)
    bar_axis.set_xlabel("skor komposit ternormalisasi (1 = terbaik)", fontsize=9)
    bar_axis.set_title(
        "Peringkat kualitas keputusan\n(normalisasi min-max antar metode)", fontsize=10
    )
    bar_axis.grid(axis="x", alpha=0.3)
    _annotate(bar_axis, "oracle di luar peringkat (batas atas)", size=7.5, y=0.985)

    angles = [index / len(metrics) * 2.0 * math.pi for index in range(len(metrics))]
    closed = [*angles, angles[0]]
    for method in (name for name in labels if name != "oracle"):
        series = [scores[method].get(metric, 0.0) for metric in metrics]
        series.append(series[0])
        radar_axis.plot(closed, series, linewidth=1.8, color=method_color(method), label=method)
        radar_axis.fill(closed, series, color=method_color(method), alpha=0.12)
    if oracle_row is not None:
        oracle_series = [scores["oracle"].get(metric, 0.0) for metric in metrics]
        oracle_series.append(oracle_series[0])
        radar_axis.plot(
            closed,
            oracle_series,
            linewidth=1.6,
            linestyle="--",
            color=ORACLE_COLOR,
            label="oracle (referensi)",
        )
    radar_axis.set_xticks(angles)
    radar_axis.set_xticklabels(metrics, fontsize=7)
    radar_axis.set_ylim(0.0, 1.0)
    radar_axis.set_title("Profil KPI kualitas ternormalisasi", fontsize=10, pad=18)
    radar_axis.legend(fontsize=7, loc="upper right", bbox_to_anchor=(1.32, 1.14))

    cost_values: list[float] = []
    for method in labels:
        entry = _entry_for(entries, method)
        cost = None if entry is None else _metric_mean(entry, "solve_time_ms")
        cost_values.append((cost or 0.0) / 1000.0)
    cost_axis.barh(
        labels[::-1],
        cost_values[::-1],
        color=[method_color(method) for method in labels][::-1],
        edgecolor="#212529",
        linewidth=0.6,
    )
    peak = max(cost_values) if cost_values else 0.0
    for position, value in enumerate(cost_values[::-1]):
        cost_axis.text(value + peak * 0.02, position, f"{value:.1f}s", va="center", fontsize=8)
    cost_axis.set_xlim(0.0, peak * 1.22 if peak > 0 else 1.0)
    cost_axis.set_xlabel("solve time rata-rata per run (detik)", fontsize=9)
    cost_axis.set_title("Biaya komputasi\n(tidak masuk peringkat kualitas)", fontsize=10)
    cost_axis.grid(axis="x", alpha=0.3)

    figure.suptitle(
        f"Perbandingan final: SERA vs metode lain — {artifacts.experiment_id}", fontsize=13
    )
    path = _save(figure, out_dir / "final_scorecard.png")
    report: Mapping[str, object] = {
        "metrics_used": list(metrics),
        "ranking": [
            {"method": method, "composite_score": round(score, 6), "kpis": count}
            for method, score, count in competitors
        ],
        "oracle_reference": (
            None
            if oracle_row is None
            else {
                "method": "oracle",
                "composite_score": round(oracle_row[1], 6),
                "kpis": oracle_row[2],
            }
        ),
        "per_kpi_scores": scores,
        "cost_seconds_per_run": dict(zip(labels, cost_values, strict=True)),
        "oracle_is_upper_bound": oracle_row is not None,
    }
    return path, report


def generate_all_charts(
    results_root: Path,
    experiment_id: str,
    *,
    out_dir: Path | None = None,
) -> Mapping[str, object]:
    """Hasilkan seluruh chart untuk satu eksperimen + tulis `charts.json`."""
    artifacts = load_artifacts(results_root, experiment_id)
    target = out_dir if out_dir is not None else artifacts.directory / "charts"
    target.mkdir(parents=True, exist_ok=True)
    produced: list[dict[str, object]] = []

    kpi_path, kpi_metrics = chart_kpi_comparison(artifacts, target)
    produced.append({"name": "kpi_comparison", "path": str(kpi_path), "metrics": list(kpi_metrics)})
    produced.extend(
        {"name": f"sweep_{path.stem.removeprefix('sweep_')}", "path": str(path)}
        for path in chart_factor_sweeps(artifacts, target)
    )
    for name, builder in (
        ("estimation_learning", chart_estimation_learning),
        ("service_trajectories", chart_service_trajectories),
    ):
        path = builder(artifacts, target)
        if path is not None:
            produced.append({"name": name, "path": str(path)})
    scorecard_path, scorecard = chart_final_scorecard(artifacts, target)
    produced.append({"name": "final_scorecard", "path": str(scorecard_path)})

    index: Mapping[str, object] = {
        "experiment_id": artifacts.experiment_id,
        "methods": list(artifacts.methods),
        "runs": len(artifacts.runs),
        "charts": produced,
        "final_scorecard": scorecard,
    }
    (target / INDEX_FILENAME).write_text(
        json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return index
