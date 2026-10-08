from __future__ import annotations

from collections.abc import Callable
from typing import Final

import numpy as np
import pytest
from hypothesis import HealthCheck
from hypothesis import settings as hypothesis_settings

from sera.core.rng import generator_for
from sera.core.types import NetworkSpec
from sera.simulator.network import NetworkIndex, branched_network, chain_network

TEST_SEED: Final = 20_261_008
HYPOTHESIS_PROFILE: Final = "sera"
SMALL_BLOCK_COUNT: Final = 6

type RngFactory = Callable[..., np.random.Generator]

hypothesis_settings.register_profile(
    HYPOTHESIS_PROFILE,
    deadline=None,
    derandomize=True,
    max_examples=100,
    suppress_health_check=(HealthCheck.too_slow,),
)
hypothesis_settings.load_profile(HYPOTHESIS_PROFILE)


@pytest.fixture(scope="session")
def seed() -> int:
    return TEST_SEED


@pytest.fixture(scope="session")
def chain_spec() -> NetworkSpec:
    return chain_network(SMALL_BLOCK_COUNT, network_id="test-chain")


@pytest.fixture(scope="session")
def branched_spec() -> NetworkSpec:
    return branched_network(SMALL_BLOCK_COUNT, network_id="test-branched")


@pytest.fixture
def chain_index(chain_spec: NetworkSpec) -> NetworkIndex:
    return NetworkIndex.from_spec(chain_spec)


@pytest.fixture
def rng_factory() -> RngFactory:
    def build(*labels: object) -> np.random.Generator:
        return generator_for(TEST_SEED, "tests", "factory", *labels)

    return build
