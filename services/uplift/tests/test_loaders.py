from __future__ import annotations

import pandas as pd

from admatix_uplift import load_criteo_uplift, load_hillstrom
from admatix_ingest import CRITEO_UPLIFT_COLUMNS, HILLSTROM_COLUMNS

from .conftest import skip_if_missing_dataset


def test_load_hillstrom():
    skip_if_missing_dataset("hillstrom")
    first = load_hillstrom()
    second = load_hillstrom()
    assert len(first) == 64_000
    assert set(HILLSTROM_COLUMNS).issubset(first.columns)
    assert set(first["treatment"].unique()) <= {0, 1, 2}
    assert int(first.loc[first["segment"] == "No E-Mail", "treatment"].iloc[0]) == 0
    pd.testing.assert_frame_equal(first, second)


def test_load_criteo_uplift():
    skip_if_missing_dataset("criteo")
    first = load_criteo_uplift(nrows=10_000)
    second = load_criteo_uplift(nrows=10_000)
    assert len(first) <= 10_000
    assert list(first.columns) == CRITEO_UPLIFT_COLUMNS
    assert int(first.iloc[0]["treatment"]) in {0, 1}
    assert int(first.iloc[0]["conversion"]) in {0, 1}
    pd.testing.assert_frame_equal(first, second)
