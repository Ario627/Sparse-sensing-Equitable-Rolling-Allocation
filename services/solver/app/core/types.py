from __future__ import annotations

import math
from collections.abc import Hashable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum


class SeraError(Exception):
    pass


class DomainInvariantError(SeraError, ValueError):
    pass


class NonIdentifiableError(SeraError):
    pass


def require_finite(value: float, name: str) -> float:
    if not math.isfinite(value):
        raise DomainInvariantError(f"{name} must be finite")
    return value


def require_non_negative(value: float, name: str) -> float:
    require_finite(value, name)
    if value < 0.0:
        raise DomainInvariantError(f"{name} must be non-negative")
    return value


def require_positive(value: float, name: str) -> float:
    require_finite(value, name)
    if value <= 0.0:
        raise DomainInvariantError(f"{name} must be positive")
    return value


def require_unit_open_closed(value: float, name: str) -> float:
    require_finite(value, name)
    if not 0.0 < value <= 1.0:
        raise DomainInvariantError(f"{name} must be in (0, 1]")
    return value


def require_efficiency(value: float, name: str) -> float:
    return require_unit_open_closed(value, name)


def require_probability(value: float, name: str) -> float:
    return require_unit_open_closed(value, name)


def require_identifier(value: str, name: str) -> str:
    if not value.strip():
        raise DomainInvariantError(f"{name} must be a non-empty identifier")
    return value


def require_utc(timestamp: datetime, name: str) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() != timedelta(0):
        raise DomainInvariantError(f"{name} must be timezone-aware UTC")
    return timestamp


def require_unique(values: Iterable[Hashable], name: str) -> None:
    seen: set[Hashable] = set()
    for value in values:
        if value in seen:
            raise DomainInvariantError(f"duplicate {name}: {value!r}")
        seen.add(value)


class NodeKind(StrEnum):
    SOURCE = "SOURCE"
    JUNCTION = "JUNCTION"
    GATE = "GATE"
    BLOCK_TERMINAL = "BLOCK_TERMINAL"


class TopologyKind(StrEnum):
    CHAIN = "CHAIN"
    BRANCHED = "BRANCHED"
    MIXED = "MIXED"


class LossZone(StrEnum):
    HEAD = "HEAD"
    MIDDLE = "MIDDLE"
    TAIL = "TAIL"


class CropStage(StrEnum):
    LAND_PREPARATION = "LAND_PREPARATION"
    VEGETATIVE = "VEGETATIVE"
    TILLERING = "TILLERING"
    PANICLE_INITIATION = "PANICLE_INITIATION"
    FLOWERING = "FLOWERING"
    GRAIN_FILLING = "GRAIN_FILLING"
    RIPENING = "RIPENING"


class SensorKind(StrEnum):
    WATER_LEVEL = "WATER_LEVEL"
    FLOW = "FLOW"
    PRESSURE = "PRESSURE"
    SOIL_MOISTURE = "SOIL_MOISTURE"
    GATE_POSITION = "GATE_POSITION"


class ReadingQuality(StrEnum):
    GOOD = "GOOD"
    SUSPECT = "SUSPECT"
    BAD = "BAD"
    STALE = "STALE"


class DeficitKind(StrEnum):
    AGRICULTURAL = "AGRICULTURAL"
    STRUCTURAL = "STRUCTURAL"


class PolicyProfile(StrEnum):
    EQUITY_FIRST = "EQUITY_FIRST"
    SHORTAGE_FIRST = "SHORTAGE_FIRST"
    BALANCED = "BALANCED"


class PlanStatus(StrEnum):
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    EXECUTED = "EXECUTED"
    SUPERSEDED = "SUPERSEDED"
    FALLBACK = "FALLBACK"


@dataclass(frozen=True, slots=True)
class Interval:
    lower: float
    upper: float

    def __post_init__(self) -> None:
        require_finite(self.lower, "lower")
        require_finite(self.upper, "upper")
        if self.upper < self.lower:
            raise DomainInvariantError("upper must be >= lower")

    @classmethod
    def degenerate(cls, value: float) -> Interval:
        return cls(value, value)

    @property
    def width(self) -> float:
        return self.upper - self.lower

    @property
    def midpoint(self) -> float:
        return (self.lower + self.upper) / 2.0

    def contains(self, value: float) -> bool:
        return self.lower <= value <= self.upper

    def clip(self, value: float) -> float:
        return min(max(value, self.lower), self.upper)


@dataclass(frozen=True, slots=True)
class TimeSlot:
    index: int
    start: datetime
    duration_h: float

    def __post_init__(self) -> None:
        if self.index < 0:
            raise DomainInvariantError("index must be non-negative")
        require_utc(self.start, "start")
        require_positive(self.duration_h, "duration_h")

    @property
    def end(self) -> datetime:
        return self.start + timedelta(hours=self.duration_h)


@dataclass(frozen=True, slots=True)
class Observation:
    sensor_id: str
    kind: SensorKind
    recorded_at: datetime
    value: float
    target_id: str | None = None
    quality: ReadingQuality = ReadingQuality.GOOD

    def __post_init__(self) -> None:
        require_identifier(self.sensor_id, "sensor_id")
        require_utc(self.recorded_at, "recorded_at")
        require_finite(self.value, "value")
        if self.target_id is not None:
            require_identifier(self.target_id, "target_id")


@dataclass(frozen=True, slots=True)
class NodeSpec:
    node_id: str
    kind: NodeKind
    order_index: int | None = None

    def __post_init__(self) -> None:
        require_identifier(self.node_id, "node_id")
        if self.order_index is not None:
            require_non_negative(self.order_index, "order_index")


@dataclass(frozen=True, slots=True)
class EdgeSpec:
    edge_id: str
    from_node_id: str
    to_node_id: str
    capacity_lps: float
    length_m: float | None = None
    zone: LossZone = LossZone.MIDDLE

    def __post_init__(self) -> None:
        require_identifier(self.edge_id, "edge_id")
        require_identifier(self.from_node_id, "from_node_id")
        require_identifier(self.to_node_id, "to_node_id")
        require_positive(self.capacity_lps, "capacity_lps")
        if self.length_m is not None:
            require_non_negative(self.length_m, "length_m")


@dataclass(frozen=True, slots=True)
class BlockSpec:
    block_id: str
    node_id: str
    area_m2: float
    nominal_flow_lps: float
    distance_from_source_m: float | None = None
    crop_type: str = "paddy"
    name: str | None = None

    def __post_init__(self) -> None:
        require_identifier(self.block_id, "block_id")
        require_identifier(self.node_id, "node_id")
        require_positive(self.area_m2, "area_m2")
        require_positive(self.nominal_flow_lps, "nominal_flow_lps")
        if self.distance_from_source_m is not None:
            require_non_negative(self.distance_from_source_m, "distance_from_source_m")
        require_identifier(self.crop_type, "crop_type")
        if self.name is not None:
            require_identifier(self.name, "name")


def _require_tree(
    nodes: tuple[NodeSpec, ...],
    edges: tuple[EdgeSpec, ...],
    source_id: str,
) -> None:
    if len(edges) != len(nodes) - 1:
        raise DomainInvariantError(
            "network must be a tree: edge count must equal node count minus one"
        )
    neighbours: dict[str, list[str]] = {node.node_id: [] for node in nodes}
    for edge in edges:
        neighbours[edge.from_node_id].append(edge.to_node_id)
        neighbours[edge.to_node_id].append(edge.from_node_id)
    seen: set[str] = {source_id}
    stack: list[str] = [source_id]
    while stack:
        current = stack.pop()
        for neighbour in neighbours[current]:
            if neighbour not in seen:
                seen.add(neighbour)
                stack.append(neighbour)
    if len(seen) != len(nodes):
        raise DomainInvariantError("network must be connected from the single SOURCE node")


@dataclass(frozen=True, slots=True)
class NetworkSpec:
    network_id: str
    topology: TopologyKind
    nodes: tuple[NodeSpec, ...]
    edges: tuple[EdgeSpec, ...]
    blocks: tuple[BlockSpec, ...]

    def __post_init__(self) -> None:
        require_identifier(self.network_id, "network_id")
        if not self.nodes or not self.edges or not self.blocks:
            raise DomainInvariantError(
                "network requires at least one node, one edge, and one block"
            )
        require_unique((node.node_id for node in self.nodes), "node_id")
        require_unique((edge.edge_id for edge in self.edges), "edge_id")
        require_unique((block.block_id for block in self.blocks), "block_id")
        require_unique((block.node_id for block in self.blocks), "block terminal node_id")
        endpoint_pairs = ((edge.from_node_id, edge.to_node_id) for edge in self.edges)
        require_unique(endpoint_pairs, "edge endpoints")
        source_ids = tuple(node.node_id for node in self.nodes if node.kind is NodeKind.SOURCE)
        if len(source_ids) != 1:
            raise DomainInvariantError("network requires exactly one SOURCE node")
        kinds = {node.node_id: node.kind for node in self.nodes}
        for edge in self.edges:
            for endpoint in (edge.from_node_id, edge.to_node_id):
                if endpoint not in kinds:
                    raise DomainInvariantError(
                        f"edge {edge.edge_id} references unknown node {endpoint}"
                    )
        for block in self.blocks:
            kind = kinds.get(block.node_id)
            if kind is None:
                raise DomainInvariantError(
                    f"block {block.block_id} references unknown node {block.node_id}"
                )
            if kind is not NodeKind.BLOCK_TERMINAL:
                raise DomainInvariantError(
                    f"block {block.block_id} must attach to a BLOCK_TERMINAL node"
                )
        _require_tree(self.nodes, self.edges, source_ids[0])


@dataclass(frozen=True, slots=True)
class DemandTargets:
    target_req_m3: float
    target_phys_m3: float
    target_fair_m3: float
    critical_stage: bool = False

    def __post_init__(self) -> None:
        require_non_negative(self.target_req_m3, "target_req_m3")
        require_non_negative(self.target_phys_m3, "target_phys_m3")
        require_non_negative(self.target_fair_m3, "target_fair_m3")
        expected = min(self.target_req_m3, self.target_phys_m3)
        if not math.isclose(self.target_fair_m3, expected, rel_tol=1e-9, abs_tol=1e-9):
            raise DomainInvariantError(
                "target_fair_m3 must equal min(target_req_m3, target_phys_m3)"
            )

    @classmethod
    def from_requirement(
        cls,
        target_req_m3: float,
        target_phys_m3: float,
        *,
        critical_stage: bool = False,
    ) -> DemandTargets:
        return cls(
            target_req_m3=target_req_m3,
            target_phys_m3=target_phys_m3,
            target_fair_m3=min(target_req_m3, target_phys_m3),
            critical_stage=critical_stage,
        )


@dataclass(frozen=True, slots=True)
class WeightedScenario:
    scenario_id: str
    probability: float

    def __post_init__(self) -> None:
        require_identifier(self.scenario_id, "scenario_id")
        require_probability(self.probability, "probability")
