from __future__ import annotations

import hashlib
from typing import Final

import numpy as np

from app.core.types import DomainInvariantError

_LABEL_SEPARATOR: Final = "\x1f"
_LABEL_KEY_WORDS: Final = 4


def _require_base_seed(base_seed: int) -> int:
    if not isinstance(base_seed, int) or isinstance(base_seed, bool):
        raise DomainInvariantError("base_seed must be an integer")
    if base_seed < 0:
        raise DomainInvariantError("base_seed must be non-negative")
    return base_seed


def _require_labels(labels: tuple[object, ...]) -> tuple[object, ...]:
    if not labels:
        raise DomainInvariantError("at least one stream label is required")
    return labels


def _label_spawn_key(labels: tuple[object, ...]) -> tuple[int, ...]:
    payload = _LABEL_SEPARATOR.join(repr(label) for label in labels).encode("utf-8")
    digest = hashlib.blake2b(payload, digest_size=_LABEL_KEY_WORDS * 4).digest()
    return tuple(
        int.from_bytes(digest[index * 4 : index * 4 + 4], "big")
        for index in range(_LABEL_KEY_WORDS)
    )


def stream_key(base_seed: int, *labels: object) -> str:
    key = _require_base_seed(base_seed)
    spawn_key = _label_spawn_key(_require_labels(labels))
    words = ".".join(f"{word:08x}" for word in spawn_key)
    return f"seed={key};stream={words}"


def seed_sequence(base_seed: int, *labels: object) -> np.random.SeedSequence:
    key = _require_base_seed(base_seed)
    spawn_key = _label_spawn_key(_require_labels(labels))
    return np.random.SeedSequence(entropy=key, spawn_key=spawn_key)


def generator_for(base_seed: int, *labels: object) -> np.random.Generator:
    return np.random.default_rng(seed_sequence(base_seed, *labels))