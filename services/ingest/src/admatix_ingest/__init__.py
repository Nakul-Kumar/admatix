from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import shutil
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

HILLSTROM_COLUMNS = [
    "recency",
    "history_segment",
    "history",
    "mens",
    "womens",
    "zip_code",
    "newbie",
    "channel",
    "segment",
    "visit",
    "conversion",
    "spend",
]

CRITEO_UPLIFT_COLUMNS = [
    *[f"f{i}" for i in range(12)],
    "treatment",
    "conversion",
    "visit",
    "exposure",
]


@dataclass(frozen=True)
class DatasetSpec:
    name: str
    source_url: str
    license: str
    redistribution: str
    columns: list[str]
    expected_rows: int | None
    compressed: bool
    output_filename: str
    citation: str = ""


@dataclass(frozen=True)
class ValidationResult:
    dataset: str
    path: Path
    rows: int
    schema_ok: bool
    reason: str


@dataclass(frozen=True)
class ChecksumRecord:
    dataset: str
    sha256: str
    checksum_path: Path
    manifest_path: Path


@dataclass(frozen=True)
class AcquisitionResult:
    dataset: str
    source_path: Path
    landed_path: Path
    checksum_path: Path
    manifest_path: Path
    sha256: str
    rows: int
    schema_ok: bool
    compressed: bool


HILLSTROM_SPEC = DatasetSpec(
    name="hillstrom",
    source_url="http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv",
    license="Public challenge dataset; attribution to Kevin Hillstrom / MineThatData recommended",
    redistribution="permissive_with_attribution_recommended",
    columns=HILLSTROM_COLUMNS,
    expected_rows=64_000,
    compressed=False,
    output_filename="hillstrom.csv",
    citation="Kevin Hillstrom, MineThatData E-Mail Analytics Data Mining Challenge, 2008",
)

CRITEO_UPLIFT_SPEC = DatasetSpec(
    name="criteo_uplift_v2.1",
    source_url="http://go.criteo.net/criteo-research-uplift-v2.1.csv.gz",
    license="Creative Commons BY-NC-SA 4.0; non-commercial, share-alike, attribution required",
    redistribution="internal_non_commercial_only",
    columns=CRITEO_UPLIFT_COLUMNS,
    expected_rows=13_979_592,
    compressed=True,
    output_filename="criteo-uplift-v2.1.csv",
    citation="Diemert et al., A Large Scale Benchmark for Uplift Modeling, AdKDD 2018",
)

DATASET_SPECS = {
    HILLSTROM_SPEC.name: HILLSTROM_SPEC,
    "criteo": CRITEO_UPLIFT_SPEC,
    CRITEO_UPLIFT_SPEC.name: CRITEO_UPLIFT_SPEC,
}


def compute_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", newline="", encoding="utf-8")
    return path.open("r", newline="", encoding="utf-8")


def validate_dataset(spec: DatasetSpec, path: Path, *, enforce_expected_rows: bool = False) -> ValidationResult:
    path = Path(path)
    try:
        with _open_text(path) as handle:
            reader = csv.reader(handle)
            header = next(reader)
            rows = sum(1 for _ in reader)
    except StopIteration:
        return ValidationResult(spec.name, path, 0, False, "empty csv")
    except UnicodeDecodeError as exc:
        return ValidationResult(spec.name, path, 0, False, f"decode failed: {exc}")

    if header != spec.columns:
        return ValidationResult(
            spec.name,
            path,
            rows,
            False,
            f"expected {len(spec.columns)} columns {spec.columns}; got {len(header)} columns {header}",
        )
    if enforce_expected_rows and spec.expected_rows is not None and rows != spec.expected_rows:
        return ValidationResult(spec.name, path, rows, False, f"expected {spec.expected_rows} rows; got {rows}")
    return ValidationResult(spec.name, path, rows, True, "ok")


def _copy_or_decompress(source: Path, target: Path, compressed: bool) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if compressed or source.suffix == ".gz":
        with gzip.open(source, "rb") as raw, target.open("wb") as out:
            shutil.copyfileobj(raw, out)
    else:
        shutil.copy2(source, target)


def write_checksum_record(
    spec: DatasetSpec,
    artifact: Path,
    checksum_root: Path,
    *,
    rows: int,
    schema_ok: bool,
) -> ChecksumRecord:
    checksum_root = Path(checksum_root)
    checksum_root.mkdir(parents=True, exist_ok=True)
    artifact = Path(artifact)
    sha256 = compute_sha256(artifact)
    checksum_path = checksum_root / f"{spec.name}.sha256"
    manifest_path = checksum_root / f"{spec.name}.manifest.json"
    checksum_path.write_text(f"{sha256}  {artifact.name}\n", encoding="utf-8")
    manifest = {
        "dataset": spec.name,
        "source_url": spec.source_url,
        "license": spec.license,
        "redistribution": spec.redistribution,
        "citation": spec.citation,
        "original_filename": artifact.name,
        "byte_size": artifact.stat().st_size,
        "sha256": sha256,
        "rows": rows,
        "expected_rows": spec.expected_rows,
        "columns": spec.columns,
        "schema_ok": schema_ok,
        "accessed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return ChecksumRecord(spec.name, sha256, checksum_path, manifest_path)


def acquire_dataset(
    spec: DatasetSpec,
    source_path: Path,
    dataset_root: Path,
    checksum_root: Path,
    *,
    enforce_expected_rows: bool = False,
) -> AcquisitionResult:
    source_path = Path(source_path)
    dataset_dir = Path(dataset_root) / spec.name
    landed_path = dataset_dir / spec.output_filename
    _copy_or_decompress(source_path, landed_path, spec.compressed)
    validation = validate_dataset(spec, landed_path, enforce_expected_rows=enforce_expected_rows)
    record = write_checksum_record(
        spec,
        source_path,
        checksum_root,
        rows=validation.rows,
        schema_ok=validation.schema_ok,
    )
    return AcquisitionResult(
        dataset=spec.name,
        source_path=source_path,
        landed_path=landed_path,
        checksum_path=record.checksum_path,
        manifest_path=record.manifest_path,
        sha256=record.sha256,
        rows=validation.rows,
        schema_ok=validation.schema_ok,
        compressed=spec.compressed or source_path.suffix == ".gz",
    )


def download_to_raw(spec: DatasetSpec, raw_root: Path) -> Path:
    raw_dir = Path(raw_root) / spec.name
    raw_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(spec.source_url).name or spec.output_filename
    target = raw_dir / filename
    if target.exists() and target.stat().st_size > 0:
        return target
    request = urllib.request.Request(spec.source_url, headers={"User-Agent": "AdMatix dataset ingest/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as out:
        shutil.copyfileobj(response, out)
    return target


def acquire_by_name(
    dataset_name: str,
    *,
    dataset_root: Path = Path("data/datasets"),
    checksum_root: Path = Path("data/checksums"),
    raw_root: Path = Path("data/raw"),
    source_path: Path | None = None,
    enforce_expected_rows: bool = False,
) -> AcquisitionResult:
    if dataset_name not in DATASET_SPECS:
        valid = ", ".join(sorted(DATASET_SPECS))
        raise ValueError(f"unknown dataset {dataset_name!r}; expected one of {valid}")
    spec = DATASET_SPECS[dataset_name]
    source = Path(source_path) if source_path is not None else download_to_raw(spec, raw_root)
    return acquire_dataset(
        spec,
        source,
        dataset_root,
        checksum_root,
        enforce_expected_rows=enforce_expected_rows,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Acquire and validate AdMatix proof datasets")
    parser.add_argument("dataset", choices=sorted(DATASET_SPECS), help="dataset key to acquire")
    parser.add_argument("--source", type=Path, help="existing local archive/CSV instead of downloading")
    parser.add_argument("--datasets-root", type=Path, default=Path("data/datasets"))
    parser.add_argument("--checksums-root", type=Path, default=Path("data/checksums"))
    parser.add_argument("--raw-root", type=Path, default=Path("data/raw"))
    parser.add_argument("--enforce-rows", action="store_true", help="require exact published row counts")
    args = parser.parse_args(argv)
    result = acquire_by_name(
        args.dataset,
        dataset_root=args.datasets_root,
        checksum_root=args.checksums_root,
        raw_root=args.raw_root,
        source_path=args.source,
        enforce_expected_rows=args.enforce_rows,
    )
    print(json.dumps({
        "dataset": result.dataset,
        "landed_path": str(result.landed_path),
        "checksum_path": str(result.checksum_path),
        "manifest_path": str(result.manifest_path),
        "sha256": result.sha256,
        "rows": result.rows,
        "schema_ok": result.schema_ok,
    }, indent=2, sort_keys=True))
    return 0 if result.schema_ok else 2


__all__ = [
    "CRITEO_UPLIFT_SPEC",
    "HILLSTROM_SPEC",
    "AcquisitionResult",
    "ChecksumRecord",
    "DatasetSpec",
    "ValidationResult",
    "acquire_by_name",
    "acquire_dataset",
    "compute_sha256",
    "download_to_raw",
    "main",
    "validate_dataset",
    "write_checksum_record",
]
