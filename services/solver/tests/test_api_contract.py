from __future__ import annotations

import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import pytest #type: ignore
from fastapi.testclient import TestClient #type: ignore

from app.main import app

pytestmark = pytest.mark.integration

POLL_ATTEMPTS: Final = 120
POLL_INTERVAL_S: Final = 0.05
TERMINAL_STATUSES: Final = ("COMPLETED", "FAILED", "CANCELLED")
MAX_REQUEST_ID: Final = 64


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as active:
        yield active


def chain_payload(block_count: int) -> dict[str, object]:
    nodes: list[dict[str, object]] = [
        {"id": "n0", "type": "SOURCE", "name": "source", "order_idx": 0}
    ]
    edges: list[dict[str, object]] = []
    blocks: list[dict[str, object]] = []
    for index in range(1, block_count + 1):
        nodes.append(
            {
                "id": f"n{index}",
                "type": "BLOCK_TERMINAL",
                "name": f"terminal {index}",
                "order_idx": index,
            }
        )
        zone = (
            "HEAD"
            if index * 3 <= block_count
            else "TAIL"
            if index * 3 > 2 * block_count
            else "MIDDLE"
        )
        edges.append(
            {
                "id": f"e{index}",
                "from_node_id": f"n{index - 1}",
                "to_node_id": f"n{index}",
                "capacity_lps": 60.0,
                "zone": zone,
                "length_m": 100.0,
            }
        )
        blocks.append(
            {
                "id": f"b{index}",
                "node_id": f"n{index}",
                "name": f"block {index}",
                "area_m2": 10_000.0,
                "crop_type": "paddy",
                "nominal_flow_lps": 10.0,
                "distance_from_source_m": 100.0 * index,
            }
        )
    return {
        "id": f"net-{block_count}",
        "name": f"chain {block_count}",
        "topology": "CHAIN",
        "nodes": nodes,
        "edges": edges,
        "blocks": blocks,
    }


def small_network() -> dict[str, object]:
    return chain_payload(2)


def envelope(request_id: str) -> dict[str, object]:
    return {"schema_version": 1, "request_id": request_id}


def plan_body(
    request_id: str,
    *,
    blocks: int = 2,
    slot_hours: float = 6.0,
    slots: int = 1,
) -> dict[str, object]:
    start = datetime(2026, 10, 8, tzinfo=UTC)
    end = start + timedelta(hours=slot_hours * slots)
    return {
        **envelope(request_id),
        "network_id": f"net-{blocks}",
        "network": chain_payload(blocks),
        "profile": "balanced",
        "horizon": {
            "from": start.isoformat().replace("+00:00", "Z"),
            "to": end.isoformat().replace("+00:00", "Z"),
            "slot_hours": slot_hours,
        },
        "params": {"supply_lps": 9.0},
    }


def poll_until_terminal(client: TestClient, experiment_id: str) -> dict[str, Any]:
    body: dict[str, Any] = {}
    for _ in range(POLL_ATTEMPTS):
        response = client.get(f"/v1/experiments/{experiment_id}")
        assert response.status_code == 200
        body = response.json()
        if body["status"] in TERMINAL_STATUSES:
            return body
        time.sleep(POLL_INTERVAL_S)
    raise AssertionError(f"experiment {experiment_id} did not finish: {body['status']}")


def failing_config_yaml(experiment_id: str, results_root: Path) -> str:
    return "\n".join(
        [
            f"experiment_id: {experiment_id}",
            "seed_base: 11",
            "methods: [sera]",
            "scenarios: [nominal]",
            "block_counts: [6]",
            "topologies: [CHAIN]",
            "k_factors: [1.0]",
            "sensor_sets: [[no-such-block]]",
            "replicates: 1",
            f"results_root: {results_root}",
        ]
    )


def success_config_yaml(experiment_id: str, results_root: Path) -> str:
    return "\n".join(
        [
            f"experiment_id: {experiment_id}",
            "seed_base: 12",
            "methods: [proportional]",
            "scenarios: [nominal]",
            "block_counts: [6]",
            "topologies: [CHAIN]",
            "k_factors: [1.0]",
            "sensor_sets: [[b1]]",
            "replicates: 1",
            f"results_root: {results_root}",
        ]
    )


def test_health_reports_version_and_runtime_state(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == 1
    assert body["status"] == "ok"
    assert body["version"]
    assert body["uptime_s"] >= 0.0
    assert body["active_experiments"] >= 0


def test_plan_returns_contract_envelope(client: TestClient) -> None:
    response = client.post("/v1/plan", json=plan_body("contract-plan"))
    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == 1
    assert body["request_id"] == "contract-plan"
    assert isinstance(body["plan_id"], str)
    assert body["plan_id"]
    assert 1 <= len(body["items"]) <= 2_000
    assert len(body["scenarios"]) <= 500
    item = body["items"][0]
    assert item["block_id"].startswith("b")
    assert item["slot_start"] < item["slot_end"]
    assert isinstance(item["gate_open"], bool)
    assert item["volume_del_m3"] is None or item["volume_del_m3"] >= 0.0
    assert body["objective"]["service_floor_z"] >= 0.0
    assert body["solver_stats"]["solver"] in {"highs", "scip", "fallback"}
    assert body["solver_stats"]["time_ms"] >= 0
    assert isinstance(body["binding_factors"], list)


def test_plan_echoes_request_id_and_keeps_deterministic_id(client: TestClient) -> None:
    first = client.post("/v1/plan", json=plan_body("contract-plan-a")).json()
    second = client.post("/v1/plan", json=plan_body("contract-plan-b")).json()
    assert first["request_id"] == "contract-plan-a"
    assert second["request_id"] == "contract-plan-b"
    assert first["plan_id"] == second["plan_id"]


def test_plan_rejects_horizon_inverted(client: TestClient) -> None:
    body = plan_body("contract-plan-bad-horizon")
    body["horizon"] = {
        "from": "2026-10-08T06:00:00Z",
        "to": "2026-10-08T00:00:00Z",
        "slot_hours": 6.0,
    }
    response = client.post("/v1/plan", json=body)
    assert response.status_code == 422
    payload = response.json()
    assert payload["error"]["code"] == "VALIDATION"
    assert isinstance(payload["detail"], str)
    assert payload["detail"]


def test_plan_rejects_oversized_request_id(client: TestClient) -> None:
    body = plan_body("x" * (MAX_REQUEST_ID + 1))
    response = client.post("/v1/plan", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION"


def test_plan_rejects_item_budget_overflow(client: TestClient) -> None:
    response = client.post(
        "/v1/plan",
        json=plan_body("contract-plan-budget", blocks=20, slot_hours=6.0, slots=101),
    )
    assert response.status_code == 422
    payload = response.json()
    assert payload["error"]["code"] == "DOMAIN_INVARIANT"
    assert "2020" in payload["error"]["message"]


def test_plan_conflicting_slot_hours_is_rejected(client: TestClient) -> None:
    body = plan_body("contract-plan-conflict")
    body["params"] = {"slot_hours": 1.0}
    response = client.post("/v1/plan", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "DOMAIN_INVARIANT"


def test_estimate_with_network_returns_state_and_loss(client: TestClient) -> None:
    response = client.post(
        "/v1/estimate",
        json={
            **envelope("contract-estimate"),
            "network_id": "net-2",
            "network": small_network(),
            "observations": [
                {
                    "sensor_id": "lvl-b1",
                    "kind": "water_level",
                    "recorded_at": "2026-10-08T00:00:00Z",
                    "value": 55.0,
                    "target_id": "b1",
                },
                {
                    "sensor_id": "lvl-b2",
                    "kind": "water_level",
                    "recorded_at": "2026-10-08T00:00:00Z",
                    "value": 47.0,
                    "target_id": "b2",
                },
            ],
            "state_prev": {
                "slot_index": 0,
                "entries": [
                    {"block_id": "b1", "mean_mm": 52.0},
                    {"block_id": "b2", "mean_mm": 45.0, "std_mm": 10.0},
                ],
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == 1
    assert body["request_id"] == "contract-estimate"
    assert [entry["block_id"] for entry in body["state"]] == ["b1", "b2"]
    assert body["loss"]
    zones = {entry["zone"] for entry in body["loss"]}
    assert zones <= {"HEAD", "MIDDLE", "TAIL"}
    assert 0.0 <= body["confidence"] <= 1.0
    diagnostics = body["diagnostics"]
    assert diagnostics["observations_used"] == 2
    assert diagnostics["observations_ignored"] == 0
    assert diagnostics["identifiability"] is not None


def test_estimate_without_state_or_network_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/estimate",
        json={
            **envelope("contract-estimate-empty"),
            "network_id": "net-2",
            "observations": [],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "DOMAIN_INVARIANT"


def test_estimate_rejects_naive_timestamp(client: TestClient) -> None:
    response = client.post(
        "/v1/estimate",
        json={
            **envelope("contract-estimate-naive"),
            "network_id": "net-2",
            "observations": [
                {
                    "sensor_id": "lvl-b1",
                    "kind": "water_level",
                    "recorded_at": "2026-10-08T00:00:00",
                    "value": 55.0,
                    "target_id": "b1",
                }
            ],
            "state_prev": {"slot_index": 0, "entries": [{"block_id": "b1", "mean_mm": 50.0}]},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION"


def test_estimate_requires_schema_version(client: TestClient) -> None:
    response = client.post(
        "/v1/estimate",
        json={"request_id": "contract-estimate-no-version", "network_id": "net-2"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION"


def test_sensing_select_returns_information_matrix(client: TestClient) -> None:
    response = client.post(
        "/v1/sensing/select",
        json={
            **envelope("contract-sensing"),
            "network_id": "net-2",
            "network": small_network(),
            "candidates": ["b1", "b2"],
            "k": 1,
            "objective": "estimation",
            "seed": 3,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["selected"]
    assert len(body["selected"]) == 1
    assert body["strategy"] in {"EXACT", "GREEDY", "GREEDY_REFINED", "RANDOM", "RANDOM_REFINED"}
    assert body["evaluated_subsets"] >= 1
    matrix = body["info_matrix"]
    assert len(matrix) == len(matrix[0])
    assert body["regret_estimate"] is None


def test_sensing_decision_objective_is_guarded(client: TestClient) -> None:
    response = client.post(
        "/v1/sensing/select",
        json={
            **envelope("contract-sensing-decision"),
            "network_id": "net-2",
            "network": small_network(),
            "candidates": ["b1"],
            "k": 1,
            "objective": "decision",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "DOMAIN_INVARIANT"


def test_simulate_open_loop_returns_trajectory(client: TestClient) -> None:
    response = client.post(
        "/v1/simulate",
        json={
            **envelope("contract-simulate"),
            "scenario_config": {
                "scenario_id": "nominal",
                "topology": "chain",
                "n_blocks": 2,
                "horizon_days": 1,
            },
            "seed": 7,
            "slot_hours": 6.0,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["slot_count"] == 4
    assert len(body["trajectory"]) == 8
    assert len(body["slots"]) == 4
    assert body["metrics"]["slots"] == 4
    assert body["metrics"]["n_resolves"] is None
    assert body["artifacts"]["parquet_path"] is None
    row = body["trajectory"][0]
    assert row["block_id"] == "b1"
    assert row["storage_mm"] >= 0.0


def test_simulate_with_policy_reports_telemetry(client: TestClient) -> None:
    response = client.post(
        "/v1/simulate",
        json={
            **envelope("contract-simulate-policy"),
            "scenario_config": {
                "scenario_id": "nominal",
                "topology": "chain",
                "n_blocks": 2,
                "horizon_days": 1,
            },
            "seed": 7,
            "slot_hours": 6.0,
            "policy": {"method": "greedy", "sensor_blocks": ["b1"]},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["n_resolves"] == 0
    assert body["metrics"]["dropouts"] is not None
    assert body["metrics"]["mean_confidence"] is not None


def test_experiment_success_lifecycle(client: TestClient, tmp_path: Path) -> None:
    experiment_id = "contract_success"
    start = client.post(
        "/v1/experiments",
        json={
            **envelope("contract-exp-start"),
            "config_yaml": success_config_yaml(experiment_id, tmp_path),
            "max_runs": 5,
        },
    )
    assert start.status_code == 202
    started = start.json()
    assert started["experiment_id"] == experiment_id
    assert started["status"] == "QUEUED"
    assert started["runs_total"] == 1
    assert len(started["config_hash"]) == 64

    body = poll_until_terminal(client, experiment_id)
    assert body["status"] == "COMPLETED"
    assert body["runs_done"] == 1
    assert body["started_at"] is not None
    assert body["finished_at"] is not None
    run = body["runs"][0]
    assert run["status"] == "COMPLETED"
    assert run["method"] == "proportional"
    assert run["metrics"]["adequacy"] >= 0.0
    assert run["parquet_path"] is not None

    metrics = client.get(f"/v1/experiments/{experiment_id}/metrics")
    assert metrics.status_code == 200
    aggregates = metrics.json()
    assert aggregates["status"] == "COMPLETED"
    assert aggregates["failures_total"] == 0
    assert "adequacy" in aggregates["aggregates"]
    assert "proportional" in aggregates["per_method"]
    assert "1" in aggregates["per_sensor_count"]

    cancel = client.post(f"/v1/experiments/{experiment_id}/cancel")
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "COMPLETED"


def test_experiment_all_runs_failed_reports_failure(client: TestClient, tmp_path: Path) -> None:
    experiment_id = "contract_failed"
    start = client.post(
        "/v1/experiments",
        json={
            **envelope("contract-exp-fail-start"),
            "config_yaml": failing_config_yaml(experiment_id, tmp_path),
        },
    )
    assert start.status_code == 202
    body = poll_until_terminal(client, experiment_id)
    assert body["status"] == "FAILED"
    assert body["runs_done"] == 1
    assert body["runs"][0]["status"] == "FAILED"
    metrics = client.get(f"/v1/experiments/{experiment_id}/metrics")
    assert metrics.status_code == 200
    payload = metrics.json()
    assert payload["failures_total"] == 1
    assert payload["aggregates"] == {}


def test_experiment_rejects_budget_overflow(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/v1/experiments",
        json={
            **envelope("contract-exp-budget"),
            "config_yaml": success_config_yaml("contract_budget", tmp_path),
            "max_runs": 0,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION"


def test_experiment_rejects_both_config_sources(client: TestClient) -> None:
    response = client.post(
        "/v1/experiments",
        json={
            **envelope("contract-exp-both"),
            "config_yaml": "experiment_id: x",
            "config": {"experiment_id": "x"},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION"


def test_unknown_experiment_is_not_found(client: TestClient) -> None:
    response = client.get("/v1/experiments/never-submitted")
    assert response.status_code == 404
    assert isinstance(response.json()["detail"], str)


def test_duplicate_experiment_id_is_rejected(client: TestClient, tmp_path: Path) -> None:
    experiment_id = "contract_duplicate"
    body = {
        **envelope("contract-exp-dup"),
        "config_yaml": success_config_yaml(experiment_id, tmp_path),
    }
    first = client.post("/v1/experiments", json=body)
    assert first.status_code == 202
    second = client.post(
        "/v1/experiments",
        json={
            **envelope("contract-exp-dup-2"),
            "config_yaml": success_config_yaml(experiment_id, tmp_path),
        },
    )
    assert second.status_code == 422
    assert second.json()["error"]["code"] == "DOMAIN_INVARIANT"
    poll_until_terminal(client, experiment_id)
