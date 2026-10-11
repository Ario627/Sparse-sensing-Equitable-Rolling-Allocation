"""Perbandingan dua lengan benchmark (sebelum/sesudah) secara berpasangan.

Dua kegunaan utama:

1. **Uji ekuivalensi.** Bila perubahan hanya menyentuh implementasi, seluruh
   metrik keputusan harus identik antara kedua lengan. Modul ini membandingkan
   setiap kolom dan melaporkan selisihnya, sehingga klaim "tidak ada perubahan
   perilaku" bisa diverifikasi, bukan diasumsikan.

2. **Perbandingan waktu berpasangan.** Waktu dinding tidak deterministik
   (`solve_time_ms` adalah waktu di dalam solver, bukan nilai yang dapat
   direproduksi), sehingga perbedaan waktu dilaporkan dengan statistik
   berpasangan + interval kepercayaan bootstrap, bukan selisih titik tunggal.

Pasangan dibentuk dari kunci environment: dua run hanya dibandingkan bila
memakai skenario, jumlah blok, topologi, k-faktor, set sensor, dan replikasi yang
sama. Seed ikut diverifikasi sama agar tidak ada perbandingan lintas-seed.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

import numpy as np
import pandas as pd

from sera.core.io import experiment_dir
from sera.core.types import DomainInvariantError
from sera.experiments.reporting import RUNS_FILENAME

PAIR_KEY: Final[tuple[str, ...]] = (
    "method",
    "scenario_id",
    "n_blocks",
    "topology",
    "k_factor",
    "sensor_set",
    "replicate",
)

# Metrik keputusan/keadaan: harus identik bila hanya implementasi yang berubah.
DECISION_METRICS: Final[tuple[str, ...]] = (
    "adequacy",
    "efficiency",
    "dependability",
    "equity",
    "worst_sr",
    "shortage_total_m3",
    "tail_deficit_m3",
    "cvar_shortage_m3",
    "state_rmse",
    "n_resolves",
    "gate_switches",
    "fallback_used",
    "decision_regret",
    "storage_coverage",
    "mean_confidence",
    "n_fallbacks",
    "review_required",
    "nis_violations",
    "dropouts",
)

# Kolom waktu: tidak deterministik, dibandingkan secara statistik.
TIMING_COLUMNS: Final[tuple[str, ...]] = (
    "model_build_seconds",
    "solver_wall_seconds",
    "run_wall_seconds",
)

EQUIVALENCE_TOLERANCE: Final = 1e-9
BOOTSTRAP_RESAMPLES: Final = 10_000
BOOTSTRAP_SEED: Final = 20261011


@dataclass(frozen=True, slots=True)
class ColumnDiff:
    column: str
    mismatches: int
    max_abs_diff: float


@dataclass(frozen=True, slots=True)
class PairedTiming:
    column: str
    pairs: int
    before_mean: float
    after_mean: float
    before_median: float
    after_median: float
    mean_difference: float
    median_difference: float
    ci_low: float
    ci_high: float
    level: float
    speedup_on_mean: float | None
    speedup_on_median: float | None


@dataclass(frozen=True, slots=True)
class ArmComparison:
    before_id: str
    after_id: str
    pairs: int
    before_runs: int
    after_runs: int
    seed_mismatches: int
    decision_diffs: tuple[ColumnDiff, ...]
    timing: tuple[PairedTiming, ...]
    timing_missing: tuple[str, ...]

    @property
    def decision_columns_equal(self) -> bool:
        return not self.decision_diffs


def load_arm(results_root: Path, experiment_id: str) -> pd.DataFrame:
    path = experiment_dir(results_root, experiment_id) / RUNS_FILENAME
    if not path.is_file():
        raise DomainInvariantError(f"missing runs artifact: {path}")
    frame = pd.read_parquet(path)
    missing = [column for column in PAIR_KEY if column not in frame.columns]
    if missing:
        raise DomainInvariantError(f"runs frame lacks pairing columns: {missing}")
    return frame


def _paired_frame(before: pd.DataFrame, after: pd.DataFrame) -> pd.DataFrame:
    key = list(PAIR_KEY)
    left = before.set_index(key)
    right = after.set_index(key)
    common = left.index.intersection(right.index)
    if len(common) == 0:
        raise DomainInvariantError("no shared environment between the two arms")
    for label, frame in (("before", left), ("after", right)):
        duplicated = int(frame.index.duplicated().sum())
        if duplicated:
            raise DomainInvariantError(
                f"{label} arm has {duplicated} duplicate environment key(s); "
                "pairing would fan out into a cartesian product"
            )
    # Index dikembalikan menjadi kolom supaya faktor environment (topology,
    # n_blocks, ...) bisa dipakai untuk mengelompokkan tanpa menebak namanya.
    return (
        left.loc[common]
        .join(right.loc[common], lsuffix="_before", rsuffix="_after", how="inner")
        .reset_index()
    )


def _records(frame: pd.DataFrame) -> tuple[Mapping[str, object], ...]:
    """Baris sebagai mapping, agar aritmetika tidak bergantung pada typing pandas."""
    records = tuple(frame.to_dict(orient="records"))
    return cast(tuple[Mapping[str, object], ...], records)


def _paired_values(
    rows: Sequence[Mapping[str, object]], column: str
) -> tuple[np.ndarray, np.ndarray]:
    """Kembalikan (before, after) sebagai array float, pasangan tanpa NaN dibuang."""
    before_name = f"{column}_before"
    after_name = f"{column}_after"
    left: list[float] = []
    right: list[float] = []
    for row in rows:
        left.append(_as_float_keep_nan(row.get(before_name)))
        right.append(_as_float_keep_nan(row.get(after_name)))
    return np.asarray(left, dtype=float), np.asarray(right, dtype=float)


def compare_columns(
    paired: pd.DataFrame,
    columns: Sequence[str],
    *,
    tolerance: float = EQUIVALENCE_TOLERANCE,
) -> tuple[ColumnDiff, ...]:
    """Kolom yang berbeda antara lengan; kolom yang tidak ada di kedua lengan dilewati."""
    rows = _records(paired)
    diffs: list[ColumnDiff] = []
    for column in columns:
        if f"{column}_before" not in paired.columns or f"{column}_after" not in paired.columns:
            continue
        left, right = _paired_values(rows, column)
        both_nan = np.isnan(left) & np.isnan(right)
        delta = np.where(both_nan, 0.0, np.abs(left - right))
        delta = np.where(np.isnan(delta) & ~both_nan, np.inf, delta)
        if delta.size == 0:
            continue
        count = int((delta > tolerance).sum())
        if count:
            diffs.append(
                ColumnDiff(
                    column=column,
                    mismatches=count,
                    max_abs_diff=float(np.max(delta[delta > tolerance])),
                )
            )
    return tuple(diffs)


def _bootstrap_ci(
    values: np.ndarray,
    *,
    level: float,
    resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = BOOTSTRAP_SEED,
) -> tuple[float, float]:
    if values.size == 0:
        return (math.nan, math.nan)
    rng = np.random.default_rng(seed)
    draws = rng.choice(values, size=(resamples, values.size), replace=True)
    means = draws.mean(axis=1)
    alpha = (1.0 - level) / 2.0
    low, high = np.quantile(means, [alpha, 1.0 - alpha])
    return (float(low), float(high))


def compare_timing(
    paired: pd.DataFrame,
    *,
    columns: Sequence[str] = TIMING_COLUMNS,
    level: float = 0.95,
) -> tuple[tuple[PairedTiming, ...], tuple[str, ...]]:
    """Perbandingan berpasangan waktu, dengan CI bootstrap pada selisih rata-rata."""
    timings: list[PairedTiming] = []
    missing: list[str] = []
    rows = _records(paired)
    for column in columns:
        if f"{column}_before" not in paired.columns or f"{column}_after" not in paired.columns:
            missing.append(column)
            continue
        left, right = _paired_values(rows, column)
        mask = ~(np.isnan(left) | np.isnan(right))
        left = left[mask]
        right = right[mask]
        if left.size == 0:
            missing.append(column)
            continue
        difference = right - left
        low, high = _bootstrap_ci(difference, level=level)
        before_mean = float(left.mean())
        after_mean = float(right.mean())
        before_median = float(np.median(left))
        after_median = float(np.median(right))
        timings.append(
            PairedTiming(
                column=column,
                pairs=int(left.size),
                before_mean=before_mean,
                after_mean=after_mean,
                before_median=before_median,
                after_median=after_median,
                mean_difference=float(difference.mean()),
                median_difference=float(np.median(difference)),
                ci_low=low,
                ci_high=high,
                level=level,
                speedup_on_mean=_safe_ratio(before_mean, after_mean),
                speedup_on_median=_safe_ratio(before_median, after_median),
            )
        )
    return tuple(timings), tuple(missing)


def _safe_ratio(numerator: float, denominator: float) -> float | None:
    if denominator == 0.0 or math.isnan(denominator):
        return None
    return numerator / denominator


def compare_arms(
    results_root: Path,
    *,
    before_id: str,
    after_id: str,
    decision_metrics: Sequence[str] = DECISION_METRICS,
    timing_columns: Sequence[str] = TIMING_COLUMNS,
    level: float = 0.95,
) -> tuple[ArmComparison, pd.DataFrame]:
    before = load_arm(results_root, before_id)
    after = load_arm(results_root, after_id)
    paired = _paired_frame(before, after)
    seed_mismatches = 0
    if "seed_before" in paired.columns and "seed_after" in paired.columns:
        seed_left, seed_right = _paired_values(_records(paired), "seed")
        finite = ~(np.isnan(seed_left) | np.isnan(seed_right))
        seed_mismatches = int((seed_left[finite] != seed_right[finite]).sum())
    diffs = compare_columns(paired, decision_metrics)
    timing, timing_missing = compare_timing(paired, columns=timing_columns, level=level)
    comparison = ArmComparison(
        before_id=before_id,
        after_id=after_id,
        pairs=len(paired),
        before_runs=len(before),
        after_runs=len(after),
        seed_mismatches=seed_mismatches,
        decision_diffs=diffs,
        timing=timing,
        timing_missing=timing_missing,
    )
    return comparison, paired


def group_timing(
    paired: pd.DataFrame, column: str, factor: str
) -> Mapping[str, Mapping[str, float]]:
    """Statistik waktu sebelum/sesudah per nilai faktor environment.

    Agregasi memakai Python biasa, bukan `DataFrame.groupby`, supaya tipe data
    eksplisit dan lolos `pyright` mode strict.
    """
    before_name = f"{column}_before"
    after_name = f"{column}_after"
    for name in (before_name, after_name, factor):
        if name not in paired.columns:
            raise DomainInvariantError(f"column {name!r} is not present in the paired frame")
    buckets: dict[str, list[tuple[float, float]]] = {}
    for row in paired.to_dict(orient="records"):
        raw_label = row.get(factor)
        before = _as_float(row.get(before_name))
        after = _as_float(row.get(after_name))
        if raw_label is None or before is None or after is None:
            continue
        buckets.setdefault(str(raw_label), []).append((before, after))
    return {
        label: {
            "n": float(len(values)),
            "before": math.fsum(item[0] for item in values) / len(values),
            "after": math.fsum(item[1] for item in values) / len(values),
            "delta": math.fsum(item[1] - item[0] for item in values) / len(values),
            "speedup": (
                math.fsum(item[0] for item in values) / math.fsum(item[1] for item in values)
                if math.fsum(item[1] for item in values) > 0.0
                else math.nan
            ),
        }
        for label, values in sorted(buckets.items())
    }


def _as_float(value: object) -> float | None:
    """Nilai untuk agregasi; NaN/inf dianggap tidak dapat dipakai.

    Dipakai hanya oleh `group_timing`, yang memang butuh angka terhingga.
    Untuk uji ekuivalensi, gunakan `_as_float_keep_nan`: di sana NaN adalah
    informasi ("tidak ada nilai") yang tidak boleh disamakan dengan nilai lain.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) else None


def _as_float_keep_nan(value: object) -> float:
    """Konversi ke float tanpa menghapus NaN.

    Non-angka (None, string, kolom hilang) menjadi NaN. Dengan begitu
    perbandingan dapat membedakan "keduanya kosong" (setara) dari
    "satu kosong, satu berisi" (perbedaan).
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return math.nan
    return float(value)


def save_timing_charts(
    paired: pd.DataFrame,
    out_dir: Path,
    *,
    comparison: ArmComparison,
    factors: Sequence[str] = ("topology", "n_blocks"),
) -> tuple[Path, ...]:
    """Chart batang sebelum/sesudah untuk tiap kolom waktu, dikelompokkan faktor."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for row in comparison.timing:
        # Hanya metode yang benar-benar menjalankan komponen ini yang digambar.
        # Baseline heuristik selalu 0 s, dan mencampurnya membuat rata-rata
        # tampak kecil padahal efeknya besar untuk metode yang menyelesaikan MILP.
        subset = _active_rows(paired, f"{row.column}_before", f"{row.column}_after")
        methods = sorted({str(record.get("method")) for record in _records(subset)})
        figure, axes = plt.subplots(1, len(factors), figsize=(13.0, 4.2), squeeze=False)
        for axis, factor in zip(axes[0], factors, strict=True):
            if factor not in subset.columns:
                axis.axis("off")
                continue
            grouped = group_timing(subset, row.column, factor)
            labels = list(grouped)
            before = [grouped[label]["before"] for label in labels]
            after = [grouped[label]["after"] for label in labels]
            positions = range(len(labels))
            axis.bar(
                [p - 0.2 for p in positions], before, width=0.4, label="sebelum", color="#8d99ae"
            )
            axis.bar(
                [p + 0.2 for p in positions], after, width=0.4, label="sesudah", color="#1b4965"
            )
            axis.set_xticks(list(positions))
            axis.set_xticklabels(labels, fontsize=8)
            axis.set_title(f"{row.column} per {factor}", fontsize=9)
            axis.set_ylabel("detik (rata-rata)", fontsize=8)
            axis.grid(axis="y", alpha=0.3)
            axis.legend(fontsize=8)
        figure.suptitle(
            f"{row.column}: sebelum {row.before_mean:.2f}s -> sesudah {row.after_mean:.2f}s "
            f"(speedup {_format_speedup(row.speedup_on_mean)}, CI {int(row.level * 100)}% "
            f"[{row.ci_low:+.2f}, {row.ci_high:+.2f}])"
            + (f" — metode: {', '.join(methods)}" if methods else ""),
            fontsize=10,
        )
        figure.tight_layout()
        path = out_dir / f"ab_{row.column}.png"
        figure.savefig(str(path), dpi=140)
        plt.close(figure)
        written.append(path)
    return tuple(written)


def _active_rows(paired: pd.DataFrame, left_name: str, right_name: str) -> pd.DataFrame:
    """Baris yang komponen waktunya benar-benar berjalan di salah satu lengan.

    Baseline heuristik tidak membangun model, sehingga kolom waktunya 0 dan
    mencampurnya akan membuat rata-rata tampak kecil.
    """
    if left_name not in paired.columns or right_name not in paired.columns:
        return paired
    keep: list[bool] = []
    any_active = False
    for record in _records(paired):
        active = (_as_float(record.get(left_name)) or 0.0) > 0.0 or (
            _as_float(record.get(right_name)) or 0.0
        ) > 0.0
        keep.append(active)
        any_active = any_active or active
    if not any_active:
        return paired
    return paired.loc[keep]


def _format_speedup(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.3f}x"


def _level_percent(comparison: ArmComparison) -> int:
    return int(comparison.timing[0].level * 100) if comparison.timing else 95


def render_markdown(comparison: ArmComparison) -> str:
    lines = [
        f"# Perbandingan A/B: {comparison.before_id} vs {comparison.after_id}",
        "",
        f"- Pasangan environment: {comparison.pairs}",
        f"- Run sebelum/sesudah: {comparison.before_runs} / {comparison.after_runs}",
        f"- Seed berbeda: {comparison.seed_mismatches}",
        "",
        "## Ekuivalensi metrik keputusan",
        "",
    ]
    if comparison.decision_columns_equal:
        lines.append(
            "Seluruh metrik keputusan identik (toleransi "
            f"{EQUIVALENCE_TOLERANCE:g}). Tidak ada perubahan perilaku terdeteksi."
        )
    else:
        lines.append("| Kolom | Jumlah berbeda | Selisih absolut maksimum |")
        lines.append("|---|---|---|")
        lines.extend(
            f"| {diff.column} | {diff.mismatches} | {diff.max_abs_diff:.6g} |"
            for diff in comparison.decision_diffs
        )
    level = _level_percent(comparison)
    lines.extend(
        [
            "",
            "## Waktu (berpasangan)",
            "",
            f"| Kolom | n | sebelum (rata2) | sesudah (rata2) | selisih | CI {level}% | speedup |",
            "|---|---|---|---|---|---|---|",
        ]
    )
    lines.extend(
        f"| {row.column} | {row.pairs} | {row.before_mean:.4f} | {row.after_mean:.4f} | "
        f"{row.mean_difference:+.4f} | [{row.ci_low:+.4f}, {row.ci_high:+.4f}] | "
        f"{'n/a' if row.speedup_on_mean is None else format(row.speedup_on_mean, '.3f')} |"
        for row in comparison.timing
    )
    if comparison.timing_missing:
        lines.extend(
            [
                "",
                "Kolom waktu tidak tersedia di salah satu lengan: "
                f"{list(comparison.timing_missing)}",
            ]
        )
    return "\n".join(lines) + "\n"
