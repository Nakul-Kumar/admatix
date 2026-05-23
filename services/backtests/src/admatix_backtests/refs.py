from __future__ import annotations

from dataclasses import dataclass


ACCESSED_DATE = "2026-05-23"


@dataclass(frozen=True)
class Reference:
    dataset: str
    outcome: str
    arm: str | None
    reference_url: str
    reference_doi: str
    accessed_date: str
    notes: str


REFERENCES: dict[tuple[str, str, str | None], Reference] = {
    ("hillstrom", "visit", "mens_email"): Reference(
        dataset="hillstrom",
        outcome="visit",
        arm="mens_email",
        reference_url="https://www.uplift-modeling.com/en/latest/api/datasets/fetch_hillstrom.html",
        reference_doi="",
        accessed_date=ACCESSED_DATE,
        notes="Hillstrom three-arm randomized email challenge; men's email visit lift is expected positive vs no-email control.",
    ),
    ("hillstrom", "visit", "womens_email"): Reference(
        dataset="hillstrom",
        outcome="visit",
        arm="womens_email",
        reference_url="https://www.uplift-modeling.com/en/latest/api/datasets/fetch_hillstrom.html",
        reference_doi="",
        accessed_date=ACCESSED_DATE,
        notes="Hillstrom three-arm randomized email challenge; women's email visit lift is expected positive vs no-email control.",
    ),
    ("criteo", "visit", None): Reference(
        dataset="criteo",
        outcome="visit",
        arm=None,
        reference_url="https://arxiv.org/abs/2111.10106",
        reference_doi="",
        accessed_date=ACCESSED_DATE,
        notes="Criteo Uplift v2.1 randomized benchmark; visit is the primary high-signal outcome.",
    ),
    ("criteo", "conversion", None): Reference(
        dataset="criteo",
        outcome="conversion",
        arm=None,
        reference_url="https://arxiv.org/abs/2111.10106",
        reference_doi="",
        accessed_date=ACCESSED_DATE,
        notes="Criteo Uplift v2.1 randomized benchmark; conversion lift is smaller and reported with looser claim limits.",
    ),
}
