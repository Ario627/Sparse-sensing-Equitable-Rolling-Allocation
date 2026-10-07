from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.core.types import (
    DomainInvariantError,
    require_identifier,
    require_non_negative,
    require_unique,
)
from baselines.base import MethodContext, validate_opens

METHOD_ID = "rotation"


@dataclass(frozen=True, slots=True)
class RotationWindow:
    group_index: int
    start_slot: int
    end_slot: int

    def __post_init__(self) -> None:
        if self.group_index < 0:
            raise DomainInvariantError("group_index must be non-negative")
        if self.start_slot < 0:
            raise DomainInvariantError("start_slot must be non-negative")
        if self.end_slot <= self.start_slot:
            raise DomainInvariantError("end_slot must exceed start_slot")

    @property
    def length(self) -> int:
        return self.end_slot - self.start_slot


@dataclass(frozen=True, slots=True)
class FixedRotationSchedule:
    block_order: tuple[str, ...]
    groups: tuple[tuple[str, ...], ...]
    window_slots: tuple[int, ...]
    windows: tuple[RotationWindow, ...]

    def __post_init__(self) -> None:
        if not self.block_order:
            raise DomainInvariantError("block_order must not be empty")
        require_unique(self.block_order, "block_id")
        if not self.groups:
            raise DomainInvariantError("groups must not be empty")
        if len(self.window_slots) != len(self.groups) or len(self.windows) != len(self.groups):
            raise DomainInvariantError("windows and window_slots must align with groups")
        known = set(self.block_order)
        assigned: list[str] = []
        for group in self.groups:
            if not group:
                raise DomainInvariantError("rotation groups must not be empty")
            for block_id in group:
                if block_id not in known:
                    raise DomainInvariantError(
                        f"rotation group references unknown block: {block_id}"
                    )
                assigned.append(block_id)
        if len(set(assigned)) != len(assigned):
            raise DomainInvariantError("blocks must belong to exactly one rotation group")
        if set(assigned) != known:
            raise DomainInvariantError("rotation groups must cover every block")
        expected_start = 0
        for index, window in enumerate(self.windows):
            if window.group_index != index:
                raise DomainInvariantError("window order must match group order")
            if window.start_slot != expected_start:
                raise DomainInvariantError("rotation windows must tile the cycle")
            if window.length != self.window_slots[index]:
                raise DomainInvariantError("window length must match window_slots")
            expected_start = window.end_slot

    @property
    def cycle_slots(self) -> int:
        return sum(self.window_slots)

    def group_at(self, slot_index: int) -> int:
        if isinstance(slot_index, bool) or not isinstance(slot_index, int) or slot_index < 0:
            raise DomainInvariantError("slot_index must be a non-negative integer")
        phase = slot_index % self.cycle_slots
        for window in self.windows:
            if window.start_slot <= phase < window.end_slot:
                return window.group_index
        raise DomainInvariantError("rotation windows do not cover the cycle")

    def opens_at(self, slot_index: int) -> dict[str, bool]:
        active = set(self.groups[self.group_at(slot_index)])
        return {block_id: block_id in active for block_id in self.block_order}


def default_groups(
    block_order: tuple[str, ...],
    n_groups: int,
) -> tuple[tuple[str, ...], ...]:
    if not block_order:
        raise DomainInvariantError("block_order must not be empty")
    if isinstance(n_groups, bool) or not isinstance(n_groups, int):
        raise DomainInvariantError("n_groups must be an integer")
    if n_groups < 1 or n_groups > len(block_order):
        raise DomainInvariantError("n_groups must lie in [1, block count]")
    base, extra = divmod(len(block_order), n_groups)
    groups: list[tuple[str, ...]] = []
    cursor = 0
    for index in range(n_groups):
        size = base + (1 if index < extra else 0)
        groups.append(block_order[cursor : cursor + size])
        cursor += size
    return tuple(groups)


def _largest_remainder_shares(
    weights: tuple[float, ...],
    total_slots: int,
) -> tuple[int, ...]:
    count = len(weights)
    if total_slots < count:
        raise DomainInvariantError("cycle_slots must be at least the number of groups")
    weight_sum = math.fsum(weights)
    if weight_sum <= 0.0:
        exact = [total_slots / count] * count
    else:
        exact = [total_slots * weight / weight_sum for weight in weights]
    shares = [max(1, math.floor(value)) for value in exact]
    delta = total_slots - sum(shares)
    if delta > 0:
        order = sorted(
            range(count),
            key=lambda index: (-(exact[index] - math.floor(exact[index])), index),
        )
        for offset in range(delta):
            shares[order[offset % count]] += 1
    while delta < 0:
        candidates = sorted(
            (index for index in range(count) if shares[index] > 1),
            key=lambda index: (exact[index] - math.floor(exact[index]), index),
        )
        if not candidates:
            raise DomainInvariantError("cannot balance rotation shares")
        shares[candidates[0]] -= 1
        delta += 1
    return tuple(shares)


def build_rotation_schedule(
    groups: Sequence[Sequence[str]],
    *,
    block_order: tuple[str, ...],
    cycle_slots: int,
    weights: Mapping[str, float] | None = None,
) -> FixedRotationSchedule:
    if not groups:
        raise DomainInvariantError("groups must not be empty")
    if isinstance(cycle_slots, bool) or not isinstance(cycle_slots, int):
        raise DomainInvariantError("cycle_slots must be an integer")
    if cycle_slots < 1:
        raise DomainInvariantError("cycle_slots must be positive")
    if weights is None:
        group_weights = (1.0,) * len(groups)
    else:
        missing = sorted(set(block_order) - set(weights))
        unknown = sorted(set(weights) - set(block_order))
        if missing or unknown:
            raise DomainInvariantError(
                f"weights keys must match block_order; missing={missing} unknown={unknown}"
            )
        resolved = {
            block_id: require_non_negative(weights[block_id], f"weights[{block_id}]")
            for block_id in block_order
        }
        group_weights = tuple(
            math.fsum(resolved[block_id] for block_id in group) for group in groups
        )
    shares = _largest_remainder_shares(group_weights, cycle_slots)
    windows: list[RotationWindow] = []
    cursor = 0
    for index, share in enumerate(shares):
        windows.append(
            RotationWindow(group_index=index, start_slot=cursor, end_slot=cursor + share)
        )
        cursor += share
    ordered_groups: list[tuple[str, ...]] = []
    for group in groups:
        members = tuple(group)
        for block_id in members:
            require_identifier(block_id, "block_id")
        ordered_groups.append(members)
    return FixedRotationSchedule(
        block_order=block_order,
        groups=tuple(ordered_groups),
        window_slots=shares,
        windows=tuple(windows),
    )


class FixedRotationMethod:
    def __init__(self, schedule: FixedRotationSchedule) -> None:
        self._schedule = schedule

    @property
    def method_id(self) -> str:
        return METHOD_ID

    @property
    def schedule(self) -> FixedRotationSchedule:
        return self._schedule

    def reset(self) -> None:
        return None

    def decide(self, context: MethodContext) -> dict[str, bool]:
        if context.block_order != self._schedule.block_order:
            raise DomainInvariantError(
                "context block order does not match the rotation schedule"
            )
        return validate_opens(
            self._schedule.opens_at(context.slot_index),
            block_order=self._schedule.block_order,
            method_id=METHOD_ID,
        )