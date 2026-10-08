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
    run.set_defaults(handler=_command_run)
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
