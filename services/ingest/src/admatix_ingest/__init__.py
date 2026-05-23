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
    # Pinned hashes for self-verifying re-acquires. Set to a known value once
    # the dataset has been downloaded and inspected; subsequent runs will
    # ABORT on mismatch instead of silently re-recording whatever bytes
    # showed up (finding #7).
    expected_archive_sha256: str | None = None
    expected_landed_sha256: str | None = None


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
    sha256: str  # hash of the LANDED file the simulator/verifier will read
    archive_sha256: str  # hash of the upstream archive (== sha256 when not compressed)
    rows: int
    schema_ok: bool
    compressed: bool


class DatasetIntegrityError(RuntimeError):
    """Raised when an acquired or cached file does not match its pinned hash."""


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
    # Hillstrom is plain CSV — archive and landed bytes are identical, so the
    # same hash pins both. Discovered on the first successful acquire.
    expected_archive_sha256="0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece",
    expected_landed_sha256="0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece",
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
    # Pin the archive hash discovered on the first successful download. The
    # landed (decompressed) hash will be populated once the decompressed file
    # has been observed; leaving it None means "record but do not enforce".
    expected_archive_sha256="2716e1bf0fd157a93b5bf86924d9088419dfbac2022c6cd90030220634f616dc",
    expected_landed_sha256=None,
)

# One canonical key per dataset (finding #19): "criteo" was an ambiguous alias.
DATASET_SPECS = {
    HILLSTROM_SPEC.name: HILLSTROM_SPEC,
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
    archive_path: Path | None = None,
) -> ChecksumRecord:
    """Record a checksum for the LANDED artifact (the file the simulator and
    verifier actually open). When the upstream archive differs (e.g., Criteo's
    .csv.gz), its hash is recorded separately as `archive_sha256` so the
    manifest captures both ends of the integrity chain (finding #6).
    """
    checksum_root = Path(checksum_root)
    checksum_root.mkdir(parents=True, exist_ok=True)
    artifact = Path(artifact)
    sha256 = compute_sha256(artifact)
    archive_path = Path(archive_path) if archive_path is not None else artifact
    archive_sha256 = (
        sha256 if archive_path.resolve() == artifact.resolve() else compute_sha256(archive_path)
    )
    checksum_path = checksum_root / f"{spec.name}.sha256"
    manifest_path = checksum_root / f"{spec.name}.manifest.json"
    # Checksum file points at the LANDED filename so `sha256sum -c` against the
    # file the downstream code reads actually validates the right bytes.
    checksum_path.write_text(f"{sha256}  {artifact.name}\n", encoding="utf-8")
    manifest = {
        "dataset": spec.name,
        "source_url": spec.source_url,
        "license": spec.license,
        "redistribution": spec.redistribution,
        "citation": spec.citation,
        "landed_filename": artifact.name,
        "original_filename": artifact.name,  # kept for back-compat
        "archive_filename": archive_path.name,
        "byte_size": artifact.stat().st_size,
        "archive_byte_size": archive_path.stat().st_size,
        "sha256": sha256,  # landed-file hash (what `sha256sum -c` checks)
        "archive_sha256": archive_sha256,  # upstream-archive hash
        "expected_landed_sha256": spec.expected_landed_sha256,
        "expected_archive_sha256": spec.expected_archive_sha256,
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
    enforce_expected_rows: bool = True,
) -> AcquisitionResult:
    """Materialize a dataset: copy/decompress the source into ``dataset_root``,
    validate its schema and row count, and write a checksum + manifest record
    keyed on the LANDED file (the bytes downstream code reads).

    Aborts via ``DatasetIntegrityError`` if either the upstream archive or the
    landed file fails to match a pinned ``expected_*_sha256`` (finding #7).
    """
    source_path = Path(source_path)
    if spec.expected_archive_sha256 is not None:
        observed = compute_sha256(source_path)
        if observed != spec.expected_archive_sha256:
            raise DatasetIntegrityError(
                f"{spec.name}: archive sha256 mismatch — "
                f"expected {spec.expected_archive_sha256}, got {observed} for {source_path}"
            )
    dataset_dir = Path(dataset_root) / spec.name
    landed_path = dataset_dir / spec.output_filename
    _copy_or_decompress(source_path, landed_path, spec.compressed)
    if spec.expected_landed_sha256 is not None:
        observed_landed = compute_sha256(landed_path)
        if observed_landed != spec.expected_landed_sha256:
            raise DatasetIntegrityError(
                f"{spec.name}: landed sha256 mismatch — "
                f"expected {spec.expected_landed_sha256}, got {observed_landed} for {landed_path}"
            )
    validation = validate_dataset(spec, landed_path, enforce_expected_rows=enforce_expected_rows)
    record = write_checksum_record(
        spec,
        landed_path,
        checksum_root,
        rows=validation.rows,
        schema_ok=validation.schema_ok,
        archive_path=source_path,
    )
    archive_sha256 = (
        record.sha256
        if Path(source_path).resolve() == landed_path.resolve()
        else compute_sha256(source_path)
    )
    return AcquisitionResult(
        dataset=spec.name,
        source_path=source_path,
        landed_path=landed_path,
        checksum_path=record.checksum_path,
        manifest_path=record.manifest_path,
        sha256=record.sha256,
        archive_sha256=archive_sha256,
        rows=validation.rows,
        schema_ok=validation.schema_ok,
        compressed=spec.compressed or source_path.suffix == ".gz",
    )


def download_to_raw(spec: DatasetSpec, raw_root: Path) -> Path:
    """Fetch ``spec.source_url`` into ``raw_root/<dataset>/``. If a cached
    file is present and a pinned ``expected_archive_sha256`` exists, the cache
    is validated against it; on mismatch the cached file is removed and
    re-downloaded (finding #8). Without a pinned hash, a non-empty cached file
    is still trusted — pin a hash in the spec to defend against partial
    downloads.
    """
    raw_dir = Path(raw_root) / spec.name
    raw_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(spec.source_url).name or spec.output_filename
    target = raw_dir / filename
    if target.exists() and target.stat().st_size > 0:
        if spec.expected_archive_sha256 is None:
            return target
        cached_hash = compute_sha256(target)
        if cached_hash == spec.expected_archive_sha256:
            return target
        # Cached file is corrupt / wrong version. Re-fetch.
        target.unlink()
    request = urllib.request.Request(spec.source_url, headers={"User-Agent": "AdMatix dataset ingest/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as out:
        shutil.copyfileobj(response, out)
    if spec.expected_archive_sha256 is not None:
        observed = compute_sha256(target)
        if observed != spec.expected_archive_sha256:
            raise DatasetIntegrityError(
                f"{spec.name}: downloaded archive sha256 mismatch — "
                f"expected {spec.expected_archive_sha256}, got {observed} for {target}"
            )
    return target


def acquire_by_name(
    dataset_name: str,
    *,
    dataset_root: Path = Path("data/datasets"),
    checksum_root: Path = Path("data/checksums"),
    raw_root: Path = Path("data/raw"),
    source_path: Path | None = None,
    enforce_expected_rows: bool = True,
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
    parser.add_argument(
        "--no-enforce-rows",
        dest="enforce_rows",
        action="store_false",
        help="skip the published-row-count check (default: enforced)",
    )
    parser.set_defaults(enforce_rows=True)
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
    "DATASET_SPECS",
    "HILLSTROM_SPEC",
    "AcquisitionResult",
    "ChecksumRecord",
    "DatasetIntegrityError",
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
