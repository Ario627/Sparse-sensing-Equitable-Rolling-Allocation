from __future__ import annotations

import argparse
import json
import signal
import sys
from collections.abc import Callable, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Final

from sera.app.settings import get_settings
from sera.core.io import experiment_dir, to_jsonable
from sera.core.types import DomainInvariantError
from sera.experiments.ab_compare import compare_arms, render_markdown, save_timing_charts
from sera.experiments.benchmark import (
    DEFAULT_WORKERS,
    execute_benchmark,
    merge_benchmark,
    parse_shard_spec,
    shard_plan,
)
from sera.experiments.charts import generate_all_charts
from sera.experiments.config import ExperimentConfig, load_experiment_config
from sera.experiments.progress import (
    ProgressCancelled,
    ProgressSnapshot,
    ProgressTracker,
    result_run_index,
)
from sera.experiments.reporting import (
    CHECKPOINT_FILENAME,
    ArtifactVerification,
    ParquetTimeseriesSink,
    ReportArtifacts,
    verify_artifacts,
    write_experiment_report,
)
from sera.experiments.runner import (
    ExperimentOutcome,
    ExperimentPlan,
    RunFailure,
    RunRecord,
    load_checkpoint,
    run_experiment,
)
from sera.experiments.summary import attach_decision_regret, build_summary
from sera.optimizer.params import DEFAULT_CATALOG, ParameterEntry, ParameterStatus

EXIT_OK: Final = 0
EXIT_ISSUES: Final = 1
EXIT_USAGE: Final = 2
EXIT_INTERRUPTED: Final = 130
MESSAGE_LIMIT: Final = 120


def locate_repo_root(start: Path) -> Path:
    current = start if start.is_absolute() else start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return current


def _argument_text(arguments: argparse.Namespace, name: str) -> str:
    value = getattr(arguments, name, None)
    if not isinstance(value, str):
        raise DomainInvariantError(f"argument {name} must be a string")
    return value


def _argument_optional_text(arguments: argparse.Namespace, name: str) -> str | None:
    value = getattr(arguments, name, None)
    if value is None:
        return None
    if not isinstance(value, str):
        raise DomainInvariantError(f"argument {name} must be a string")
    return value


def _argument_flag(arguments: argparse.Namespace, name: str) -> bool:
    value = getattr(arguments, name, None)
    if not isinstance(value, bool):
        raise DomainInvariantError(f"argument {name} must be a boolean")
    return value


def _argument_number(arguments: argparse.Namespace, name: str) -> float:
    value = getattr(arguments, name, None)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"argument {name} must be a number")
    return float(value)


def _argument_integer(arguments: argparse.Namespace, name: str) -> int:
    value = getattr(arguments, name, None)
    if isinstance(value, bool) or not isinstance(value, int):
        raise DomainInvariantError(f"argument {name} must be an integer")
    return value


def _format_duration(seconds: float) -> str:
    if seconds < 60.0:
        return f"{seconds:.1f}s"
    minutes, remainder = divmod(seconds, 60.0)
    if minutes < 60.0:
        return f"{int(minutes)}m{remainder:04.1f}s"
    hours, minutes = divmod(minutes, 60.0)
    return f"{int(hours)}h{int(minutes):02d}m"


def _truncate(text: str, limit: int = MESSAGE_LIMIT) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3] + "..."


def _progress_line(snapshot: ProgressSnapshot, item: RunRecord | RunFailure) -> str:
    spec = item.spec
    counter = f"[{snapshot.runs_finished:>5}/{snapshot.runs_total}]"
    label = (
        f"{spec.method.value:<12} {spec.scenario_id:<14} n={spec.n_blocks:<2} k={spec.k_factor:.2f}"
    )
    if isinstance(item, RunFailure):
        return f"{counter} FAILED {label} {item.error_type}: {_truncate(item.message)}"
    metrics = item.metrics
    seconds = metrics.solve_time_ms / 1000.0
    return (
        f"{counter} {label} sen={spec.sensor_count:<4} r={spec.replicate:<2} "
        f"adeq={metrics.adequacy:>6.3f} short={metrics.shortage_total_m3:>8.1f} "
        f"eq={metrics.equity:>6.3f} {_format_duration(seconds):>8}"
    )


type RunReporter = Callable[[RunRecord | RunFailure], None]


def _make_reporter(tracker: ProgressTracker, *, quiet: bool) -> RunReporter:
    def report(item: RunRecord | RunFailure) -> None:
        failed = isinstance(item, RunFailure)
        snapshot = tracker.complete_run(result_run_index(item), failed=failed)
        if quiet:
            return
        sys.stderr.write(_progress_line(snapshot, item) + "\n")
        sys.stderr.flush()

    return report


def _install_cancel_handler(tracker: ProgressTracker) -> None:
    def handle(signum: int, frame: object) -> None:
        tracker.request_cancel()
        sys.stderr.write("cancel requested; finishing the current run\n")
        sys.stderr.flush()

    signal.signal(signal.SIGINT, handle)


def _completed_run_indexes(checkpoint_path: Path, plan: ExperimentPlan) -> frozenset[int]:
    contents = load_checkpoint(checkpoint_path)
    known = {spec.run_index for spec in plan.specs}
    return frozenset(
        record.spec.run_index for record in contents.records if record.spec.run_index in known
    )


def _resolve_results_root(arguments: argparse.Namespace, config: ExperimentConfig) -> Path:
    override = _argument_optional_text(arguments, "out")
    if override is not None:
        return Path(override).expanduser()
    if config.results_root is not None:
        return config.results_root
    return get_settings().results_dir


def _report_cancelled(tracker: ProgressTracker) -> None:
    snapshot = tracker.snapshot()
    sys.stderr.write(
        f"cancelled after {snapshot.runs_finished} finished runs; checkpoint preserved\n"
    )


def _print_outcome(outcome: ExperimentOutcome, artifacts: ReportArtifacts) -> None:
    print(
        f"{outcome.experiment_id}  runs {outcome.completed_count}"
        f"  failures {outcome.failure_count}"
        f"  skipped {outcome.skipped}"
        f"  wall {_format_duration(outcome.wall_seconds)}"
    )
    print(f"checkpoint  {artifacts.directory / CHECKPOINT_FILENAME}")
    print(f"meta        {artifacts.meta_path}")
    print(f"runs        {artifacts.runs_path}")
    print(f"summary     {artifacts.summary_path}")


def _command_run(arguments: argparse.Namespace) -> int:
    settings = get_settings()
    config = load_experiment_config(
        Path(_argument_text(arguments, "config")),
        default_seed_base=settings.seed_base,
    )
    results_root = _resolve_results_root(arguments, config)
    plan = config.build_plan()
    shard_argument = _argument_optional_text(arguments, "shard")
    if shard_argument is not None:
        shard_index, shard_count = parse_shard_spec(shard_argument)
        plan = shard_plan(plan, shard_index=shard_index, shard_count=shard_count)
    checkpoint_path = experiment_dir(results_root, plan.experiment_id) / CHECKPOINT_FILENAME
    pending = _completed_run_indexes(checkpoint_path, plan)
    executor = config.executor
    if not _argument_flag(arguments, "no_timeseries"):
        executor = replace(
            executor,
            timeseries_sink=ParquetTimeseriesSink(results_root, plan.experiment_id),
        )
    tracker = ProgressTracker(plan)
    reporter = _make_reporter(tracker, quiet=_argument_flag(arguments, "quiet"))
    _install_cancel_handler(tracker)
    tracker.start()
    if pending:
        tracker.mark_skipped(len(pending))
    try:
        outcome = run_experiment(
            plan,
            executor,
            checkpoint_path=checkpoint_path,
            resume=not _argument_flag(arguments, "no_resume"),
            fail_fast=_argument_flag(arguments, "fail_fast"),
            on_result=reporter,
        )
    except ProgressCancelled, KeyboardInterrupt:
        tracker.mark_cancelled()
        _report_cancelled(tracker)
        return EXIT_INTERRUPTED
    tracker.complete()
    records = attach_decision_regret(outcome.records)
    summary = build_summary(
        records,
        outcome.failures,
        experiment_id=plan.experiment_id,
        plan_hash=plan.config_hash,
        seed=plan.seed_base,
    )
    artifacts = write_experiment_report(
        results_root,
        plan,
        records=records,
        summary=summary,
        repo=locate_repo_root(Path(__file__)),
    )
    _print_outcome(outcome, artifacts)
    return EXIT_OK if outcome.failure_count == 0 else EXIT_ISSUES


def _command_benchmark(arguments: argparse.Namespace) -> int:
    settings = get_settings()
    out_override = _argument_optional_text(arguments, "out")
    report, artifacts = execute_benchmark(
        Path(_argument_text(arguments, "config")),
        results_root=None if out_override is None else Path(out_override).expanduser(),
        workers=_argument_integer(arguments, "workers"),
        default_seed_base=settings.seed_base,
        repo=locate_repo_root(Path(__file__)),
    )
    print(
        f"{report.experiment_id}  runs {report.runs}  failures {report.failures}"
        f"  workers {report.workers}  wall {_format_duration(report.wall_seconds)}"
    )
    for shard in report.shards:
        print(
            f"  shard {shard.index:>2}  runs {shard.records:<4}"
            f" failures {shard.failures:<3} wall {_format_duration(shard.wall_seconds)}"
        )
    print(f"runs        {report.runs_path}")
    print(f"summary     {report.summary_path}")
    charts = artifacts.charts.get("charts")
    if isinstance(charts, list):
        for chart in charts:
            if isinstance(chart, dict):
                print(f"chart       {chart.get('path')}")
    scorecard = artifacts.charts.get("final_scorecard")
    if isinstance(scorecard, dict):
        ranking = scorecard.get("ranking")
        if isinstance(ranking, list):
            print("peringkat final:")
            for row in ranking:
                if isinstance(row, dict):
                    print(f"  {row.get('method')!s:<14} skor {row.get('composite_score')}")
    return EXIT_OK if report.failures == 0 else EXIT_ISSUES


def _command_merge(arguments: argparse.Namespace) -> int:
    """Gabungkan checkpoint shard yang sudah selesai menjadi artefak + chart."""
    settings = get_settings()
    config_path = Path(_argument_text(arguments, "config"))
    config = load_experiment_config(config_path, default_seed_base=settings.seed_base)
    out_override = _argument_optional_text(arguments, "out")
    root = Path(out_override).expanduser() if out_override is not None else config.results_root
    if root is None:
        print("error: results_root must be provided by config or --out", file=sys.stderr)
        return EXIT_USAGE
    workers = _argument_integer(arguments, "workers")
    plan = config.build_plan()
    outcome, artifacts, copied, out_of_plan = merge_benchmark(
        root, plan, workers=workers, repo=locate_repo_root(Path(__file__))
    )
    charts = generate_all_charts(root, plan.experiment_id)
    print(
        f"{plan.experiment_id}  runs {outcome.completed_count}"
        f"  failures {outcome.failure_count}  timeseries {copied}"
        f"  di luar plan {out_of_plan}"
    )
    print(f"runs        {artifacts.runs_path}")
    print(f"summary     {artifacts.summary_path}")
    entries = charts.get("charts")
    if isinstance(entries, list):
        for chart in entries:
            if isinstance(chart, dict):
                print(f"chart       {chart.get('path')}")
    scorecard = charts.get("final_scorecard")
    if isinstance(scorecard, dict):
        ranking = scorecard.get("ranking")
        if isinstance(ranking, list):
            print("peringkat final:")
            for row in ranking:
                if isinstance(row, dict):
                    print(f"  {row.get('method')!s:<14} skor {row.get('composite_score')}")
    return EXIT_OK if outcome.failure_count == 0 else EXIT_ISSUES


def _command_compare_ab(arguments: argparse.Namespace) -> int:
    """Bandingkan dua lengan benchmark secara berpasangan."""
    settings = get_settings()
    out_override = _argument_optional_text(arguments, "out")
    root = Path(out_override).expanduser() if out_override is not None else settings.results_dir
    comparison, paired = compare_arms(
        root,
        before_id=_argument_text(arguments, "before"),
        after_id=_argument_text(arguments, "after"),
        level=_argument_number(arguments, "level"),
    )
    charts_dir = _argument_optional_text(arguments, "charts")
    if charts_dir is not None:
        target = Path(charts_dir).expanduser()
        for path in save_timing_charts(paired, target, comparison=comparison):
            print(f"chart       {path}")
    text = render_markdown(comparison)
    output = _argument_optional_text(arguments, "report")
    if output is not None:
        target = Path(output).expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        print(f"report      {target}")
    print(text, end="")
    return EXIT_ISSUES if comparison.decision_diffs else EXIT_OK


def _command_verify(arguments: argparse.Namespace) -> int:
    settings = get_settings()
    override = _argument_optional_text(arguments, "out")
    results_root = settings.results_dir if override is None else Path(override).expanduser()
    report: ArtifactVerification = verify_artifacts(
        results_root, _argument_text(arguments, "experiment")
    )
    for issue in report.issues:
        print(f"issue: {issue}")
    if report.is_consistent:
        print(
            f"{report.experiment_id}  runs {report.runs_rows}"
            f"  failures {report.checkpoint_failures}"
            f"  hashes consistent"
        )
        return EXIT_OK
    print(f"{report.experiment_id}  inconsistent ({len(report.issues)} issues)")
    return EXIT_ISSUES


def _format_number(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:g}"


def _format_range(lower: float | None, upper: float | None) -> str:
    if lower is None and upper is None:
        return "-"
    return f"{_format_number(lower)}..{_format_number(upper)}"


def _parameter_row(entry: ParameterEntry) -> tuple[str, ...]:
    return (
        entry.key,
        _format_number(entry.value),
        _format_range(entry.lower, entry.upper),
        entry.unit if entry.unit is not None else "-",
        entry.status.value,
        entry.source,
    )


def _print_parameter_table(entries: Sequence[ParameterEntry]) -> None:
    headers = ("key", "value", "range", "unit", "status", "source")
    rows = [_parameter_row(entry) for entry in entries]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_join_row(headers, widths))
    for row in rows:
        print(_join_row(row, widths))


def _join_row(cells: Sequence[str], widths: Sequence[int]) -> str:
    return "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells)).rstrip()


def _command_params(arguments: argparse.Namespace) -> int:
    status_filter = _argument_optional_text(arguments, "status")
    entries: Sequence[ParameterEntry] = DEFAULT_CATALOG
    if status_filter is not None:
        wanted = ParameterStatus(status_filter)
        entries = tuple(entry for entry in DEFAULT_CATALOG if entry.status is wanted)
    if not entries:
        print("no parameters match the filter")
        return EXIT_OK
    if _argument_flag(arguments, "json"):
        print(json.dumps(to_jsonable(entries), indent=2, ensure_ascii=False))
        return EXIT_OK
    _print_parameter_table(entries)
    return EXIT_OK


def _dispatch(arguments: argparse.Namespace) -> int:
    handler = getattr(arguments, "handler", None)
    if not callable(handler):
        raise DomainInvariantError("no command handler was selected")
    result = handler(arguments)
    if isinstance(result, bool) or not isinstance(result, int):
        raise DomainInvariantError("command handler returned a non-integer status")
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sera-exp",
        description="SERA solver experiment runner",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("run", help="jalankan eksperimen dari file config YAML")
    run.add_argument("--config", required=True, help="path ke file config YAML")
    run.add_argument("--out", default=None, help="root direktori hasil; menimpa config")
    run.add_argument(
        "--no-resume",
        action="store_true",
        help="tolak checkpoint yang sudah berisi hasil",
    )
    run.add_argument("--fail-fast", action="store_true", help="berhenti pada kegagalan pertama")
    run.add_argument(
        "--no-timeseries",
        action="store_true",
        help="lewati penulisan Parquet timeseries",
    )
    run.add_argument("--quiet", action="store_true", help="hanya cetak ringkasan akhir")
    run.add_argument(
        "--shard",
        default=None,
        help="jalankan hanya sebagian grid, format INDEX/COUNT (dipakai benchmark)",
    )
    run.set_defaults(handler=_command_run)
    benchmark = subparsers.add_parser(
        "benchmark",
        help="jalankan grid besar secara paralel lalu hasilkan chart",
    )
    benchmark.add_argument("--config", required=True, help="path ke file config YAML")
    benchmark.add_argument("--out", default=None, help="root direktori hasil; menimpa config")
    benchmark.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"jumlah proses paralel (default {DEFAULT_WORKERS})",
    )
    benchmark.set_defaults(handler=_command_benchmark)
    merge = subparsers.add_parser(
        "merge",
        help="gabungkan checkpoint shard yang sudah ada menjadi artefak + chart",
    )
    merge.add_argument("--config", required=True, help="path ke file config YAML")
    merge.add_argument("--out", default=None, help="root direktori hasil; menimpa config")
    merge.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"jumlah shard yang dipakai saat menjalankan (default {DEFAULT_WORKERS})",
    )
    merge.set_defaults(handler=_command_merge)
    compare = subparsers.add_parser(
        "compare-ab",
        help="bandingkan dua lengan benchmark secara berpasangan (sebelum/sesudah)",
    )
    compare.add_argument("--before", required=True, help="experiment_id lengan sebelum")
    compare.add_argument("--after", required=True, help="experiment_id lengan sesudah")
    compare.add_argument("--out", default=None, help="root direktori hasil")
    compare.add_argument(
        "--level", type=float, default=0.95, help="tingkat keyakinan bootstrap (default 0.95)"
    )
    compare.add_argument("--report", default=None, help="tulis laporan markdown ke path ini")
    compare.add_argument(
        "--charts", default=None, help="direktori untuk chart batang sebelum/sesudah"
    )
    compare.set_defaults(handler=_command_compare_ab)
    verify = subparsers.add_parser("verify", help="periksa konsistensi artefak eksperimen")
    verify.add_argument("--experiment", required=True, help="id eksperimen")
    verify.add_argument("--out", default=None, help="root direktori hasil")
    verify.set_defaults(handler=_command_verify)
    params = subparsers.add_parser("params", help="tampilkan katalog parameter")
    params.add_argument(
        "--status",
        choices=[status.value for status in ParameterStatus],
        default=None,
        help="filter berdasarkan status parameter",
    )
    params.add_argument("--json", action="store_true", help="cetak katalog sebagai JSON")
    params.set_defaults(handler=_command_params)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    arguments = parser.parse_args(argv)
    try:
        return _dispatch(arguments)
    except DomainInvariantError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":
    raise SystemExit(main())
