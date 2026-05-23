from __future__ import annotations

import csv
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from admatix_ingest import (  # noqa: E402
    CRITEO_UPLIFT_SPEC,
    HILLSTROM_SPEC,
    DatasetSpec,
    acquire_dataset,
    compute_sha256,
    validate_dataset,
    write_checksum_record,
)


def _write_csv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def test_hillstrom_schema_checksum_and_manifest(tmp_path: Path) -> None:
    source = tmp_path / "hillstrom.csv"
    _write_csv(
        source,
        HILLSTROM_SPEC.columns,
        [
            [1, "$0 - $100", 83.0, 1, 0, "Urban", 0, "Phone", "No E-Mail", 0, 0, 0.0],
            [4, "$100 - $200", 128.5, 0, 1, "Rural", 1, "Web", "Mens E-Mail", 1, 1, 42.5],
        ],
    )

    result = acquire_dataset(HILLSTROM_SPEC, source, tmp_path / "datasets", tmp_path / "checksums")

    assert result.dataset == "hillstrom"
    assert result.rows == 2
    assert result.landed_path == tmp_path / "datasets" / "hillstrom" / "hillstrom.csv"
    assert result.sha256 == compute_sha256(source)
    assert result.schema_ok is True
    assert (tmp_path / "checksums" / "hillstrom.sha256").read_text(encoding="utf-8").startswith(result.sha256)
    manifest = json.loads((tmp_path / "checksums" / "hillstrom.manifest.json").read_text(encoding="utf-8"))
    assert manifest["license"] == HILLSTROM_SPEC.license
    assert manifest["redistribution"] == "permissive_with_attribution_recommended"


def test_criteo_uplift_gzip_lands_decompressed_and_validates_schema(tmp_path: Path) -> None:
    csv_path = tmp_path / "criteo-uplift-v2.1.csv"
    rows = [
        [0.1] * 12 + [1, 0, 1, 1],
        [0.2] * 12 + [0, 0, 0, 0],
    ]
    _write_csv(csv_path, CRITEO_UPLIFT_SPEC.columns, rows)
    source = tmp_path / "criteo-uplift-v2.1.csv.gz"
    with csv_path.open("rb") as raw, gzip.open(source, "wb") as compressed:
        compressed.write(raw.read())

    result = acquire_dataset(CRITEO_UPLIFT_SPEC, source, tmp_path / "datasets", tmp_path / "checksums")

    assert result.dataset == "criteo_uplift_v2.1"
    assert result.rows == 2
    assert result.compressed is True
    assert result.landed_path.name == "criteo-uplift-v2.1.csv"
    assert result.landed_path.exists()
    assert validate_dataset(CRITEO_UPLIFT_SPEC, result.landed_path).schema_ok is True
    manifest = json.loads((tmp_path / "checksums" / "criteo_uplift_v2.1.manifest.json").read_text(encoding="utf-8"))
    assert manifest["redistribution"] == "internal_non_commercial_only"


def test_schema_rejects_missing_or_misordered_columns(tmp_path: Path) -> None:
    source = tmp_path / "bad.csv"
    _write_csv(source, ["segment", "visit"], [["No E-Mail", 0]])

    result = validate_dataset(HILLSTROM_SPEC, source)

    assert result.schema_ok is False
    assert "expected 12 columns" in result.reason


def test_write_checksum_record_is_stable_and_git_safe(tmp_path: Path) -> None:
    artifact = tmp_path / "artifact.csv"
    artifact.write_text("a,b\n1,2\n", encoding="utf-8")
    spec = DatasetSpec(
        name="tiny",
        source_url="https://example.invalid/tiny.csv",
        license="test-only",
        redistribution="permissive_with_attribution_recommended",
        columns=["a", "b"],
        expected_rows=None,
        compressed=False,
        output_filename="tiny.csv",
    )

    record = write_checksum_record(spec, artifact, tmp_path / "checksums", rows=1, schema_ok=True)

    assert record.sha256 == compute_sha256(artifact)
    assert record.checksum_path.name == "tiny.sha256"
    assert record.manifest_path.name == "tiny.manifest.json"
    assert "data/datasets" not in record.manifest_path.read_text(encoding="utf-8")
