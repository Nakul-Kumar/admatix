from pathlib import Path


def test_evidence_package_exists() -> None:
    assert (Path(__file__).parent / "package.json").exists()
