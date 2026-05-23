from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .types import UpliftConfig


CRITEO_LICENSE_NOTE = (
    "Criteo Uplift v2.1 is CC BY-NC-SA 4.0 - internal R&D use only; "
    "non-commercial; share-alike; attribution to Diemert et al. AdKDD 2018."
)


@dataclass(frozen=True)
class QiniCriteoResult:
    rows_total: int
    rows_train: int
    rows_test: int
    qini_visit: float
    auuc_visit: float
    qini_conversion: float
    auuc_conversion: float
    cate_model: str
    qini_curve_visit_path: Path
    qini_curve_conversion_path: Path
    metrics_path: Path
    license_note: str = CRITEO_LICENSE_NOTE


def run_qini_criteo(config: UpliftConfig) -> QiniCriteoResult:
    raise NotImplementedError("run_qini_criteo is implemented after the public API stub commit")
