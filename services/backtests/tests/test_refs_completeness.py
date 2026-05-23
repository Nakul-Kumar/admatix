from __future__ import annotations

import re


def test_reference_registry_covers_invokable_dataset_outcomes():
    from admatix_backtests.refs import REFERENCES

    expected = {
        ("hillstrom", "visit", "mens_email"),
        ("hillstrom", "visit", "womens_email"),
        ("criteo", "visit", None),
        ("criteo", "conversion", None),
    }
    assert expected.issubset(set(REFERENCES))
    for ref in REFERENCES.values():
        assert ref.reference_url.startswith("https://")
        assert "localhost" not in ref.reference_url
        assert "127.0.0.1" not in ref.reference_url
        assert not ref.reference_url.startswith("file://")
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", ref.accessed_date)
        assert ref.notes
