"""Prepare 88 City housing-stock reference records, without writing to Supabase.

Python 3.10+ and pdfplumber 0.11.9 (pip install pdfplumber==0.11.9).
Run from any directory:
  python backend/tools/prepare_housing.py --cache-dir work/housing-pdfs
  python backend/tools/prepare_housing.py --cache-dir work/housing-pdfs --offline
  python backend/tools/prepare_housing.py --self-test

Only three pinned 2024 City PDFs are fetched (at most 2 MB each). A changed
publication fails closed for review; the previous output is not overwritten.
Historical construction years describe the current reference housing stock,
not a time series of old observations. No raw PDFs are committed.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import tempfile
import unittest
from urllib.request import Request, urlopen


BACKEND = Path(__file__).resolve().parents[1]
BASE = "https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/"
MAX_BYTES = 2_000_000
SOURCES = (
    {
        "source_id": "coh_housing_structure_2024",
        "title": "Units in Structure",
        "filename": "11-Units-in-Structure-2024.pdf",
        "sha256": "cd061bffb8bcf57c11b65d6d74960709261102739c426cc97a4395f98fd2189a",
        "pages": 2,
        "group": "structure_counts",
        "columns": ["total_housing_units", "single_unit_detached", "single_unit_attached", "two_units", "three_or_four_units", "five_to_nine_units", "ten_or_more_units", "mobile_home", "boat_rv_van_other"],
        "headers": ["1, detached unit", "1, attached unit", "10 or more units", "Boat, RV, van, etc."],
    },
    {
        "source_id": "coh_housing_bedrooms_2024",
        "title": "Bedrooms",
        "filename": "12-Bedrooms-2024.pdf",
        "sha256": "f5436416f0129a5d62b44f0d651589867b636f573cf940387459bcba9a198508",
        "pages": 4,
        "group": "bedroom_counts",
        "columns": ["total_housing_units", "no_bedroom", "one_bedroom", "two_bedrooms", "three_bedrooms", "four_bedrooms", "five_or_more_bedrooms"],
        "headers": ["No bedroom", "1 bedroom", "2 bedrooms", "5 or more"],
    },
    {
        "source_id": "coh_housing_year_built_2024",
        "title": "Year Structure Built",
        "filename": "13-Year-Structure-Built-2024.pdf",
        "sha256": "28eb878b6afe22ff57ff08c6ad7f279fe6bc69279efc5827346d2831e6effa01",
        "pages": 3,
        "group": "year_built_counts",
        "columns": ["total_housing_units", "built_1939_or_earlier", "built_1940_to_1959", "built_1960_to_1979", "built_1980_to_1999", "built_2000_to_2009", "built_2010_to_2019", "built_2020_or_later"],
        "headers": ["Built 1939 or", "Built 1940 to", "Built 2010 to", "Built 2020 or"],
    },
)
SUPPRESSIONS = {"-", "--", "—", "...", "(X)", "N", "N/A"}
NAME_ALIASES = {65: "HARRISBURG / MANCHESTER"}


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def canonical_name(value):
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def count_value(token):
    if token in SUPPRESSIONS:
        return None
    if not re.fullmatch(r"(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)", token):
        raise ValueError(f"Invalid housing count: {token!r}")
    value = int(token.replace(",", ""))
    if value > 1_000_000:
        raise ValueError("Housing count exceeds the bounded neighborhood scope")
    return value


def validate_distribution(values):
    total, *counts = values
    if total is None or total <= 0:
        raise ValueError("A positive published housing total is required")
    if any(n is not None and n > total for n in counts):
        raise ValueError("A housing category exceeds the published total")
    if any(n is None for n in counts):
        if sum(n for n in counts if n is not None) > total + math.floor(len(values) / 2):
            raise ValueError("Known housing categories exceed total plus rounding tolerance")
        return None
    difference = sum(counts) - total
    # Independently rounded categories plus rounded total can differ by this
    # many units. Retain the original counts and report the difference.
    if abs(difference) > math.floor(len(values) / 2):
        raise ValueError("Category sum differs beyond independent-rounding tolerance")
    return difference


def parse_pages(texts, source, names):
    if len(texts) != source["pages"]:
        raise ValueError("Unexpected PDF page count")
    rows = {}
    for page_number, text in enumerate(texts, 1):
        if not text or "SUPER NEIGHBORHOOD DEMOGRAPHICS 2024" not in text or "2020-2024 ACS 5-Year Estimate" not in text:
            raise ValueError("Missing expected 2024/2020-2024 provenance header")
        if source["title"].upper() not in text:
            raise ValueError("Unexpected table title")
        if not all(header in text for header in source["headers"]):
            raise ValueError("Housing table columns changed")
        for line in text.splitlines():
            # pdfplumber sometimes joins a two-digit ID directly to its name.
            matched = re.match(r"^(\d{1,2})\s*([A-Z].*)$", line.strip())
            if not matched:
                continue
            identifier = int(matched[1])
            if identifier not in names or identifier in rows:
                raise ValueError("Unknown or duplicate neighborhood ID")
            parts = matched[2].rsplit(None, len(source["columns"]))
            if len(parts) != len(source["columns"]) + 1:
                raise ValueError("Missing or shifted housing table cells")
            name, tokens = parts[0], parts[1:]
            alias = canonical_name(name) != canonical_name(names[identifier])
            if alias and name != NAME_ALIASES.get(identifier):
                raise ValueError(f"Neighborhood name mismatch for {identifier}")
            values = [count_value(token) for token in tokens]
            difference = validate_distribution(values)
            rows[identifier] = {
                "values": dict(zip(source["columns"], values)),
                "page": page_number,
                "sum_difference_units": difference,
                "source_name": name,
                "name_alias": alias,
            }
    if set(rows) != set(range(1, 89)):
        raise ValueError("Housing import must contain all 88 neighborhood IDs")
    return rows


def cached_retrieval_time(metadata_path, source, now=None):
    """Only an explicit retrieval receipt can establish when a PDF was checked."""
    try:
        receipt = json.loads(metadata_path.read_text(encoding="utf8"))
        value = receipt["source_retrieved_at"]
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value):
            raise ValueError("A timezone-aware retrieval timestamp is required")
        checked = datetime.fromisoformat(value.replace("Z", "+00:00"))
        current = now or datetime.now(timezone.utc)
        if checked.timestamp() > current.timestamp() + 300:
            raise ValueError("Retrieval timestamp is in the future")
        # Legacy receipts contain the date only; the pinned PDF hash is still
        # checked below. New receipts also bind that date to the exact source.
        if receipt.get("source_sha256", source["sha256"]) != source["sha256"] or receipt.get("source_url", BASE + source["filename"]) != BASE + source["filename"]:
            raise ValueError("Retrieval receipt belongs to another source")
        return checked.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise ValueError("Offline PDF has no valid retrieval receipt; rerun without --offline to check the source. File timestamps cannot establish freshness.") from error


def read_pdf(source, cache_dir, offline):
    path = cache_dir / source["filename"]
    metadata_path = path.with_suffix(".retrieval.json")
    if offline:
        data = path.read_bytes()
        retrieved = cached_retrieval_time(metadata_path, source)
    else:
        request = Request(BASE + source["filename"], headers={"User-Agent": "HouMatchReferenceImport/1.0", "Accept": "application/pdf"})
        with urlopen(request, timeout=30) as response:
            if response.status != 200:
                raise ValueError("PDF source did not return HTTP 200")
            data = response.read(MAX_BYTES + 1)
        retrieved = timestamp()
    if len(data) > MAX_BYTES or not data.startswith(b"%PDF-"):
        raise ValueError("Source is not a bounded PDF")
    if hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError(f"Published PDF changed: review {source['filename']} before updating the pinned hash")
    if not offline:
        cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        metadata_path.write_text(json.dumps({"source_retrieved_at": retrieved, "source_url": BASE + source["filename"], "source_sha256": source["sha256"]}) + "\n", encoding="utf8")
    import pdfplumber
    with pdfplumber.open(io.BytesIO(data)) as document:
        texts = [page.extract_text(x_tolerance=3, y_tolerance=3) for page in document.pages]
    return texts, retrieved


def percent(total, *values):
    return None if any(v is None for v in values) else round(100 * sum(values) / total, 2)


def prepare(cache_dir, offline):
    reference = json.loads((BACKEND / "data/reference/super-neighborhoods-2024.json").read_text(encoding="utf8"))
    names = {row["neighborhood_id"]: row["name"] for row in reference["neighborhoods"]}
    if len(names) != 88 or set(names) != set(range(1, 89)):
        raise ValueError("Canonical neighborhood reference is incomplete")
    parsed, sources = {}, []
    for source in SOURCES:
        texts, retrieved = read_pdf(source, cache_dir, offline)
        parsed[source["group"]] = parse_pages(texts, source, names)
        sources.append({
            "source_id": source["source_id"], "title": source["title"],
            "source_url": BASE + source["filename"], "source_sha256": source["sha256"],
            "source_period_start": 2020, "source_period_end": 2024,
            "source_release_month": "2026-01", "source_retrieved_at": retrieved,
            "record_count": 88, "unit": "estimated_housing_units", "refresh_cadence": "annual_release",
        })
    rows = []
    for identifier in range(1, 89):
        groups = {group: table[identifier] for group, table in parsed.items()}
        totals = {record["values"]["total_housing_units"] for record in groups.values()}
        if len(totals) != 1:
            raise ValueError("Housing totals disagree between City tables")
        total = totals.pop()
        facts = {"total_housing_units": total}
        flags, audit = [], {}
        for group, record in groups.items():
            facts[group] = {key: value for key, value in record["values"].items() if key != "total_housing_units"}
            missing = [key for key, value in facts[group].items() if value is None]
            flags.extend(f"{group}.{key}_unavailable" for key in missing)
            if record["sum_difference_units"]:
                flags.append(f"{group}_rounded_sum_differs_from_total")
            audit[group] = {"source_page": record["page"], "sum_difference_units": record["sum_difference_units"]}
        if any(record["name_alias"] for record in groups.values()):
            flags.append("published_name_alias")
            audit["published_name"] = NAME_ALIASES[identifier]
        s, b, y = facts["structure_counts"], facts["bedroom_counts"], facts["year_built_counts"]
        facts["shares_pct"] = {
            "single_unit_detached": percent(total, s["single_unit_detached"]),
            "single_unit_attached": percent(total, s["single_unit_attached"]),
            "two_or_more_units_in_structure": percent(total, s["two_units"], s["three_or_four_units"], s["five_to_nine_units"], s["ten_or_more_units"]),
            "studio_or_one_bedroom": percent(total, b["no_bedroom"], b["one_bedroom"]),
            "two_bedrooms": percent(total, b["two_bedrooms"]),
            "three_or_more_bedrooms": percent(total, b["three_bedrooms"], b["four_bedrooms"], b["five_or_more_bedrooms"]),
            "built_2000_or_later": percent(total, y["built_2000_to_2009"], y["built_2010_to_2019"], y["built_2020_or_later"]),
            "built_2020_or_later": percent(total, y["built_2020_or_later"]),
        }
        rows.append({"neighborhood_id": identifier, "name": names[identifier], "facts": facts, "quality_flags": flags, "audit": audit})
    version = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]
    return {
        "schema_version": 1, "data_version": f"coh-housing-2024-{version}",
        "source_period_start": 2020, "source_period_end": 2024,
        "prepared_at": timestamp(), "record_count": 88, "sources": sources,
        "attribution": "City of Houston Planning and Development; U.S. Census Bureau ACS 2020–2024 five-year estimates",
        "interpretation": [
            "Marginal housing-stock estimates for all housing units, not current listings, available rentals, affordability, building condition, or an individual's housing eligibility.",
            "Structure, bedroom and year-built distributions are separate marginals: do not infer counts of homes satisfying combinations of these attributes.",
            "Built 2020 or later is relative to the 2020–2024 observation period; it does not include verified construction after 2024.",
            "Shares use each table's published housing total. Original rounded counts are preserved; category sums can differ slightly from the total.",
            "Missing or suppressed cells are null, never zero; dependent derived shares remain null. Margins of error are not provided in these City tables.",
            "Housing preferences must come from the candidate; do not infer a preference from family status, age, or demographic composition.",
        ],
        "rows": rows,
    }


class ValidationTests(unittest.TestCase):
    def test_undated_offline_pdf_is_rejected_regardless_of_file_timestamp(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            pdf = cache / SOURCES[0]["filename"]
            pdf.write_bytes(b"%PDF-undated")
            os.utime(pdf, (2_000_000_000, 2_000_000_000))
            with self.assertRaisesRegex(ValueError, "retrieval receipt"):
                read_pdf(SOURCES[0], cache, True)

    def test_cached_receipt_keeps_old_date_and_rejects_invalid_or_foreign_dates(self):
        now = datetime(2026, 9, 19, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            path.write_text(json.dumps({"source_retrieved_at": "2026-08-01T12:00:00-05:00"}))
            self.assertEqual(cached_retrieval_time(path, SOURCES[0], now), "2026-08-01T17:00:00Z")
            for receipt in [{}, None, {"source_retrieved_at": 1}, {"source_retrieved_at": "2026-09-01"},
                            {"source_retrieved_at": "2026-09-01T00:00:00"}, {"source_retrieved_at": "2026-99-01T00:00:00Z"},
                            {"source_retrieved_at": "2026-10-01T00:00:00Z"},
                            {"source_retrieved_at": "2026-09-01T00:00:00Z", "source_sha256": "wrong"}]:
                path.write_text(json.dumps(receipt))
                with self.assertRaisesRegex(ValueError, "retrieval receipt"):
                    cached_retrieval_time(path, SOURCES[0], now)

    def test_count_suppression_and_zero(self):
        self.assertEqual(count_value("0"), 0)
        self.assertEqual(count_value("12,345"), 12345)
        for marker in SUPPRESSIONS:
            self.assertIsNone(count_value(marker))
        for marker in ["-1", "12,34", "3.2", "NaN", "", "01"]:
            with self.assertRaises(ValueError):
                count_value(marker)

    def test_rounding_is_preserved_and_large_error_rejected(self):
        self.assertEqual(validate_distribution([10, 4, 5]), -1)
        with self.assertRaises(ValueError):
            validate_distribution([10, 2, 5])
        with self.assertRaises(ValueError):
            validate_distribution([10, 11, 0])

    def test_unknown_does_not_become_zero(self):
        self.assertIsNone(validate_distribution([10, None, 5]))
        self.assertIsNone(percent(10, None, 5))
        self.assertEqual(percent(10, 0, 5), 50.0)

    def test_all_ids_and_schema_required(self):
        source = SOURCES[0]
        header = "SUPER NEIGHBORHOOD DEMOGRAPHICS 2024\nUNITS IN STRUCTURE\n2020-2024 ACS 5-Year Estimate\n" + " ".join(source["headers"])
        names = {i: "EXAMPLE" for i in range(1, 89)}
        lines = [f"{i} EXAMPLE 100 10 10 10 10 10 10 20 20" for i in names]
        valid = [header + "\n" + "\n".join(lines[:44]), header + "\n" + "\n".join(lines[44:])]
        self.assertEqual(len(parse_pages(valid, source, names)), 88)
        for pages in [[valid[0], header], [valid[0], valid[0]], [valid[0].replace("2024", "2023"), valid[1]], [valid[0].replace("1 EXAMPLE", "1 WRONG"), valid[1]]]:
            with self.assertRaises(ValueError):
                parse_pages(pages, source, names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path("work/housing-pdfs"))
    parser.add_argument("--output", type=Path, default=BACKEND / "data/neighborhood-housing.json")
    parser.add_argument("--offline", action="store_true", help="Verify and reuse cached PDFs without claiming a fresh source check")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ValidationTests))
        raise SystemExit(0 if result.wasSuccessful() else 1)
    snapshot = prepare(args.cache_dir, args.offline)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf8", dir=args.output.parent, prefix=".housing-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(snapshot, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
        temporary.replace(args.output)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    print(json.dumps({"records": 88, "bytes": args.output.stat().st_size, "data_version": snapshot["data_version"], "output": str(args.output)}))


if __name__ == "__main__":
    main()
