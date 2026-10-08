from __future__ import annotations

from typing import Final

import numpy as np
import pytest

from sera.core.types import DomainInvariantError
from sera.estimator.identifiability import (
    IdentifiabilityFailure,
    IdentifiabilityReport,
    IdentifiabilityThresholds,
    InformationWindow,
    information_contribution,
    information_matrix,
)

DIAGONAL_ZERO_EPSILON: Final = 1.0e-30


def diagonal_matrix(values: list[float]) -> np.ndarray:
    return np.diag(np.array(values, dtype=float))


def test_information_contribution_scales_by_inverse_noise() -> None:
    jacobian = np.eye(2)
    noise = diagonal_matrix([4.0, 9.0])
    contribution = information_contribution(jacobian, noise)
    assert contribution[0, 0] == pytest.approx(0.25)
    assert contribution[1, 1] == pytest.approx(1.0 / 9.0)
    assert contribution[0, 1] == pytest.approx(0.0)


def test_information_contribution_is_symmetric_for_rectangular_jacobian() -> None:
    jacobian = np.array([[1.0, 0.0, 0.5], [0.0, 1.0, 0.5]], dtype=float)
    noise = diagonal_matrix([1.0, 1.0])
    contribution = information_contribution(jacobian, noise)
    assert contribution.shape == (3, 3)
    assert np.allclose(contribution, contribution.T)


def test_information_contribution_rejects_mismatched_dimensions() -> None:
    jacobian = np.eye(2)
    with pytest.raises(DomainInvariantError):
        information_contribution(jacobian, diagonal_matrix([1.0, 1.0, 1.0]))
    with pytest.raises(DomainInvariantError):
        information_contribution(jacobian, np.array([1.0, 1.0], dtype=float))


def test_information_contribution_rejects_singular_noise() -> None:
    jacobian = np.eye(2)
    with pytest.raises(DomainInvariantError):
        information_contribution(jacobian, diagonal_matrix([1.0, 0.0]))


def test_information_contribution_of_rank_one_jacobian_is_rank_one() -> None:
    jacobian = np.array([[1.0, 2.0]], dtype=float)
    contribution = information_contribution(jacobian, diagonal_matrix([1.0]))
    assert int(np.linalg.matrix_rank(contribution)) == 1


def test_information_matrix_sums_contributions() -> None:
    first = diagonal_matrix([1.0, 2.0])
    second = diagonal_matrix([3.0, 4.0])
    total = information_matrix((first, second))
    assert np.allclose(total, diagonal_matrix([4.0, 6.0]))


def test_information_matrix_rejects_empty_and_mismatched_shapes() -> None:
    with pytest.raises(DomainInvariantError):
        information_matrix(())
    with pytest.raises(DomainInvariantError):
        information_matrix((diagonal_matrix([1.0]), diagonal_matrix([1.0, 2.0])))


def test_thresholds_require_positive_values() -> None:
    with pytest.raises(DomainInvariantError):
        IdentifiabilityThresholds(min_eigenvalue=0.0)
    with pytest.raises(DomainInvariantError):
        IdentifiabilityThresholds(max_condition_number=-1.0)


def test_identity_information_passes_every_check() -> None:
    report = IdentifiabilityReport.assess(diagonal_matrix([1.0, 1.0]))
    assert report.passed is True
    assert report.failures == ()
    assert report.rank == 2
    assert report.expected_rank == 2
    assert report.min_eigenvalue == pytest.approx(1.0)
    assert report.condition_number == pytest.approx(1.0)


def test_rank_deficient_information_reports_all_three_failures() -> None:
    report = IdentifiabilityReport.assess(diagonal_matrix([1.0, 1.0, DIAGONAL_ZERO_EPSILON]))
    assert report.passed is False
    assert report.rank == 2
    assert set(report.failures) == {
        IdentifiabilityFailure.RANK_DEFICIENT,
        IdentifiabilityFailure.WEAK_EIGENVALUE,
        IdentifiabilityFailure.ILL_CONDITIONED,
    }


def test_weak_eigenvalue_flagged_above_noise_floor() -> None:
    report = IdentifiabilityReport.assess(diagonal_matrix([1.0, 1.0e-10]))
    assert IdentifiabilityFailure.WEAK_EIGENVALUE in report.failures
    assert IdentifiabilityFailure.RANK_DEFICIENT not in report.failures


def test_ill_conditioned_flagged_independently() -> None:
    thresholds = IdentifiabilityThresholds(min_eigenvalue=1.0e-12, max_condition_number=1.0e6)
    report = IdentifiabilityReport.assess(diagonal_matrix([1.0, 1.0e-7]), thresholds)
    assert report.failures == (IdentifiabilityFailure.ILL_CONDITIONED,)
    assert report.condition_number == pytest.approx(1.0e7)


def test_expected_rank_allows_overdetermined_parameters() -> None:
    report = IdentifiabilityReport.assess(diagonal_matrix([1.0, 1.0, 1.0]), expected_rank=2)
    assert report.passed is True
    assert report.rank == 3
    assert report.expected_rank == 2


def test_expected_rank_rejects_values_above_dimension() -> None:
    with pytest.raises(DomainInvariantError):
        IdentifiabilityReport.assess(diagonal_matrix([1.0, 1.0]), expected_rank=3)


def test_eigenvalues_are_ascending_with_weakest_direction() -> None:
    report = IdentifiabilityReport.assess(diagonal_matrix([1.0, 1.0, 0.5]))
    assert tuple(report.eigenvalues) == pytest.approx((0.5, 1.0, 1.0))
    assert tuple(abs(value) for value in report.weakest_direction) == pytest.approx((0.0, 0.0, 1.0))


def test_information_window_keeps_only_recent_contributions() -> None:
    window = InformationWindow(2)
    window.add(diagonal_matrix([1.0]))
    window.add(diagonal_matrix([2.0]))
    window.add(diagonal_matrix([4.0]))
    assert window.window == 2
    assert window.size == 2
    assert np.allclose(window.matrix(), diagonal_matrix([6.0]))


def test_information_window_assesses_accumulated_matrix() -> None:
    window = InformationWindow(3)
    window.add(diagonal_matrix([1.0, 0.0]))
    window.add(diagonal_matrix([0.0, 1.0]))
    report = window.assess()
    assert report.passed is True
    assert report.rank == 2


def test_information_window_rejects_invalid_inputs() -> None:
    with pytest.raises(DomainInvariantError):
        InformationWindow(0)
    window = InformationWindow(1)
    with pytest.raises(DomainInvariantError):
        window.add(np.array([1.0, 2.0], dtype=float))
