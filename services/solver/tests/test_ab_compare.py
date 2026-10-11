"""Test untuk perbandingan A/B berpasangan."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Final

import pandas as pd
import pytest

from sera.core.types import DomainInvariantError
from sera.experiments.ab_compare import (
    TIMING_COLUMNS,
    compare_arms,
    compare_columns,
    compare_timing,
    group_timing,
    load_arm,
    render_markdown,
    save_timing_charts,
)
from sera.experiments.reporting import experiment_paths, runs_frame

PAIR_ROWS: Final = 6


def _row(index: int, *, build: float, adequacy: float) -> dict[str, object]:
    # `replicate` membuat kunci pasangan unik; tanpa itu setiap baris dalam satu
    # lengan berbagi kunci yang sama dan join menjadi perkalian kartesian.
    return {
        "method": "sera",
        "scenario_id": "nominal",
        "n_blocks": 6,
        "topology": "CHAIN",
        "k_factor": 1.0,
        "sensor_set": '["b2"]',
        "replicate": index,
        "seed": 1000 + index,
        "adequacy": adequacy,
        "dependability": 0.5,
        "worst_sr": 0.6,
        "shortage_total_m3": 100.0,
        "cvar_shortage_m3": 10.0,
        "n_resolves": 120,
        "gate_switches": 5,
        "fallback_used": False,
        "n_fallbacks": 0,
        "model_build_seconds": build,
        "solver_wall_seconds": build * 5.0,
        "run_wall_seconds": build * 6.0,
    }


def _write_arm(root: Path, experiment_id: str, rows: list[dict[str, object]]) -> None:
    paths = experiment_paths(root, experiment_id)
    paths.directory.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame(rows)
    frame.to_parquet(paths.runs_path, index=False)


def _paired_frame(before_build: list[float], after_build: list[float]) -> pd.DataFrame:
    left = pd.DataFrame(
        [_row(index, build=value, adequacy=0.9) for index, value in enumerate(before_build)]
    ).add_suffix("_before")
    right = pd.DataFrame(
        [_row(index, build=value, adequacy=0.9) for index, value in enumerate(after_build)]
    ).add_suffix("_after")
    return pd.concat([left, right], axis=1)


class TestLoadArm:
    def test_missing_artifact_raises(self, tmp_path: Path) -> None:
        with pytest.raises(DomainInvariantError, match="missing runs artifact"):
            load_arm(tmp_path, "tidak_ada")


class TestCompareColumns:
    def test_identical_columns_report_no_difference(self) -> None:
        frame = _paired_frame([1.0, 2.0], [0.5, 1.0])
        assert compare_columns(frame, ("adequacy", "dependability")) == ()

    def test_difference_is_detected(self) -> None:
        frame = _paired_frame([1.0, 2.0], [0.5, 1.0])
        frame["adequacy_after"] = [0.9, 0.7]
        diffs = compare_columns(frame, ("adequacy",))
        assert len(diffs) == 1
        assert diffs[0].column == "adequacy"
        assert diffs[0].mismatches == 1
        assert diffs[0].max_abs_diff == pytest.approx(0.2)

    def test_missing_column_is_skipped(self) -> None:
        frame = _paired_frame([1.0], [0.5])
        assert compare_columns(frame, ("kolom_tidak_ada",)) == ()

    def test_nan_matches_nan(self) -> None:
        frame = _paired_frame([1.0, 2.0], [0.5, 1.0])
        frame["worst_sr_before"] = [float("nan"), 0.6]
        frame["worst_sr_after"] = [float("nan"), 0.6]
        assert compare_columns(frame, ("worst_sr",)) == ()

    def test_nan_versus_value_is_a_difference(self) -> None:
        frame = _paired_frame([1.0], [0.5])
        frame["worst_sr_before"] = [float("nan")]
        frame["worst_sr_after"] = [0.6]
        diffs = compare_columns(frame, ("worst_sr",))
        assert len(diffs) == 1
        assert math.isinf(diffs[0].max_abs_diff)


class TestCompareTiming:
    def test_speedup_is_reported(self) -> None:
        frame = _paired_frame([10.0, 10.0, 10.0], [5.0, 5.0, 5.0])
        rows, missing = compare_timing(frame, columns=("model_build_seconds",))
        assert missing == ()
        assert len(rows) == 1
        row = rows[0]
        assert row.pairs == 3
        assert row.before_mean == pytest.approx(10.0)
        assert row.after_mean == pytest.approx(5.0)
        assert row.mean_difference == pytest.approx(-5.0)
        assert row.speedup_on_mean == pytest.approx(2.0)

    def test_confidence_interval_brackets_the_difference(self) -> None:
        frame = _paired_frame([10.0, 12.0, 11.0, 13.0], [5.0, 6.0, 5.5, 6.5])
        rows, _ = compare_timing(frame, columns=("model_build_seconds",))
        row = rows[0]
        assert row.ci_low <= row.mean_difference <= row.ci_high
        assert row.level == pytest.approx(0.95)

    def test_uncertainty_shrinks_with_identical_differences(self) -> None:
        tight = _paired_frame([10.0] * 8, [5.0] * 8)
        rows, _ = compare_timing(tight, columns=("model_build_seconds",))
        row = rows[0]
        assert row.ci_low == pytest.approx(-5.0)
        assert row.ci_high == pytest.approx(-5.0)

    def test_missing_column_is_reported(self) -> None:
        frame = _paired_frame([1.0], [0.5])
        rows, missing = compare_timing(frame, columns=("tidak_ada",))
        assert rows == ()
        assert missing == ("tidak_ada",)

    def test_nan_pairs_are_dropped(self) -> None:
        frame = _paired_frame([1.0, 2.0], [0.5, 1.0])
        frame["model_build_seconds_before"] = [1.0, float("nan")]
        frame["model_build_seconds_after"] = [0.5, float("nan")]
        rows, _ = compare_timing(frame, columns=("model_build_seconds",))
        assert rows[0].pairs == 1


class TestCompareArms:
    def test_equivalent_arms_are_reported_equal(self, tmp_path: Path) -> None:
        _write_arm(
            tmp_path,
            "arm_before",
            [_row(index, build=10.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        _write_arm(
            tmp_path,
            "arm_after",
            [_row(index, build=5.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        comparison, paired = compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")
        assert comparison.pairs == PAIR_ROWS
        assert comparison.seed_mismatches == 0
        assert comparison.decision_columns_equal
        assert len(paired) == PAIR_ROWS

    def test_changed_decision_metric_is_flagged(self, tmp_path: Path) -> None:
        _write_arm(
            tmp_path,
            "arm_before",
            [_row(index, build=10.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        changed = [_row(index, build=5.0, adequacy=0.9) for index in range(PAIR_ROWS)]
        changed[0]["adequacy"] = 0.5
        _write_arm(tmp_path, "arm_after", changed)
        comparison, _ = compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")
        assert not comparison.decision_columns_equal
        assert comparison.decision_diffs[0].column == "adequacy"

    def test_seed_mismatch_is_detected(self, tmp_path: Path) -> None:
        _write_arm(
            tmp_path,
            "arm_before",
            [_row(index, build=10.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        rows = [_row(index, build=5.0, adequacy=0.9) for index in range(PAIR_ROWS)]
        for row in rows:
            row["seed"] = 9999
        _write_arm(tmp_path, "arm_after", rows)
        comparison, _ = compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")
        assert comparison.seed_mismatches == PAIR_ROWS

    def test_duplicate_environment_keys_are_rejected(self, tmp_path: Path) -> None:
        """Kunci ganda akan menggandakan pasangan secara kartesian; harus ditolak."""
        duplicates = [_row(0, build=10.0, adequacy=0.9) for _ in range(3)]
        _write_arm(tmp_path, "arm_before", duplicates)
        _write_arm(tmp_path, "arm_after", duplicates)
        with pytest.raises(DomainInvariantError, match="duplicate environment key"):
            compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")

    def test_disjoint_arms_raise(self, tmp_path: Path) -> None:
        _write_arm(tmp_path, "arm_before", [_row(0, build=1.0, adequacy=0.9)])
        other = _row(0, build=1.0, adequacy=0.9)
        other["sensor_set"] = '["b5"]'
        _write_arm(tmp_path, "arm_after", [other])
        with pytest.raises(DomainInvariantError, match="no shared environment"):
            compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")


class TestGroupTiming:
    def test_groups_by_factor(self) -> None:
        frame = _paired_frame([10.0, 10.0, 20.0], [5.0, 5.0, 10.0])
        frame["topology_before"] = ["CHAIN", "CHAIN", "BRANCHED"]
        frame["topology_after"] = ["CHAIN", "CHAIN", "BRANCHED"]
        grouped = group_timing(frame, "model_build_seconds", "topology_before")
        assert set(grouped) == {"CHAIN", "BRANCHED"}
        assert grouped["CHAIN"]["before"] == pytest.approx(10.0)
        assert grouped["CHAIN"]["speedup"] == pytest.approx(2.0)
        assert grouped["BRANCHED"]["n"] == pytest.approx(1.0)

    def test_unknown_column_raises(self) -> None:
        frame = _paired_frame([1.0], [0.5])
        with pytest.raises(DomainInvariantError, match="not present"):
            group_timing(frame, "model_build_seconds", "faktor_tidak_ada")


class TestTimingCharts:
    def test_charts_are_written_and_non_empty(self, tmp_path: Path) -> None:
        _write_arm(
            tmp_path,
            "arm_before",
            [_row(index, build=10.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        _write_arm(
            tmp_path,
            "arm_after",
            [_row(index, build=5.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        comparison, paired = compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")
        paths = save_timing_charts(
            paired, tmp_path / "charts", comparison=comparison, factors=("n_blocks",)
        )
        assert len(paths) == len(TIMING_COLUMNS)
        for path in paths:
            assert path.is_file()
            assert path.stat().st_size > 1000

    def test_missing_factor_leaves_panel_empty(self, tmp_path: Path) -> None:
        _write_arm(tmp_path, "arm_before", [_row(0, build=1.0, adequacy=0.9)])
        _write_arm(tmp_path, "arm_after", [_row(0, build=0.5, adequacy=0.9)])
        comparison, paired = compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")
        paths = save_timing_charts(
            paired, tmp_path / "charts", comparison=comparison, factors=("tidak_ada",)
        )
        assert paths
        assert all(path.is_file() for path in paths)


class TestRenderMarkdown:
    def test_equivalence_and_timing_are_reported(self, tmp_path: Path) -> None:
        _write_arm(
            tmp_path,
            "arm_before",
            [_row(index, build=10.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        _write_arm(
            tmp_path,
            "arm_after",
            [_row(index, build=5.0, adequacy=0.9) for index in range(PAIR_ROWS)],
        )
        comparison, _ = compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")
        text = render_markdown(comparison)
        assert "Ekuivalensi metrik keputusan" in text
        assert "model_build_seconds" in text
        assert "2.000" in text  # speedup

    def test_differences_are_tabulated(self, tmp_path: Path) -> None:
        _write_arm(tmp_path, "arm_before", [_row(0, build=1.0, adequacy=0.9)])
        rows = [_row(0, build=1.0, adequacy=0.4)]
        _write_arm(tmp_path, "arm_after", rows)
        comparison, _ = compare_arms(tmp_path, before_id="arm_before", after_id="arm_after")
        text = render_markdown(comparison)
        assert "| adequacy |" in text


def test_runs_frame_helper_is_not_required_for_synthetic_frames() -> None:
    """Sanity: helper `runs_frame` tetap ada untuk jalur nyata."""
    assert callable(runs_frame)
