"""Read-only Houston CKAN discovery tool; Python 3.10+, standard library only."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_URL = os.environ.get("HOUSTON_DATA_BASE_URL", "https://data.houstontx.gov").rstrip("/")
MAX_RESPONSE_BYTES = 10 * 1024 * 1024


def action(name, **params):
    """Call a public read endpoint, with bounded retries for transient failures."""
    url = f"{BASE_URL}/api/3/action/{name}?{urlencode(params)}"
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "hou-match/0.1"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise RuntimeError("Response exceeds 10 MiB; request a smaller page.")
            payload = json.loads(raw)
            if payload.get("success") is not True:
                raise RuntimeError(f"CKAN rejected {name}: {payload.get('error')}")
            return payload["result"]
        except HTTPError as exc:
            if exc.code not in (429, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f"Houston {name} returned HTTP {exc.code}.") from exc
        except (URLError, TimeoutError) as exc:
            if attempt == 2:
                raise RuntimeError(f"Houston {name} could not be reached.") from exc
        time.sleep(2 ** attempt)


def dataset_summary(dataset):
    return {
        "id": dataset["id"],
        "name": dataset["name"],
        "title": dataset["title"],
        "portal_url": f"{BASE_URL}/dataset/{dataset['name']}",
        "organization": (dataset.get("organization") or {}).get("title"),
        "metadata_modified": dataset.get("metadata_modified"),
        "license_id": dataset.get("license_id"),
        "license_title": dataset.get("license_title"),
        "license_url": dataset.get("license_url"),
        "tags": [tag["name"] for tag in dataset.get("tags", [])],
        "resources": [
            {key: resource.get(key) for key in (
                "id", "name", "format", "url", "datastore_active", "last_modified"
            )}
            for resource in dataset.get("resources", [])
        ],
    }


def catalog():
    datasets = []
    start = 0
    while True:
        page = action("package_search", rows=100, start=start, sort="name asc")
        if not page["results"]:
            if start < page["count"]:
                raise RuntimeError("Catalog pagination ended before the reported total.")
            break
        datasets.extend(dataset_summary(item) for item in page["results"])
        start += len(page["results"])
        if start >= page["count"]:
            break
    if len({item["id"] for item in datasets}) != len(datasets):
        raise RuntimeError("Catalog changed during pagination; retry the snapshot.")
    return {
        "source": BASE_URL,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "dataset_count": len(datasets),
        "datasets": datasets,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="Check the public portal")
    search = sub.add_parser("search", help="Find datasets by keyword")
    search.add_argument("query")
    search.add_argument("--limit", type=int, choices=range(1, 101), default=10, metavar="1-100")
    show = sub.add_parser("dataset", help="Show resource IDs and download URLs")
    show.add_argument("id", help="Dataset slug or UUID")
    sample = sub.add_parser("sample", help="Read a bounded DataStore sample")
    sample.add_argument("resource_id")
    sample.add_argument("--limit", type=int, choices=range(1, 101), default=5, metavar="1-100")
    sample.add_argument("--offset", type=int, default=0)
    snapshot = sub.add_parser("catalog", help="Snapshot catalog metadata, without downloading data files")
    snapshot.add_argument("--output", type=Path)
    args = parser.parse_args()

    try:
        if args.command == "status":
            status = action("status_show")
            result = {key: status.get(key) for key in ("site_title", "site_url", "ckan_version")}
        elif args.command == "search":
            page = action("package_search", q=args.query, rows=args.limit)
            result = {"count": page["count"], "datasets": [dataset_summary(item) for item in page["results"]]}
        elif args.command == "dataset":
            result = dataset_summary(action("package_show", id=args.id))
        elif args.command == "sample":
            if args.offset < 0:
                parser.error("--offset must be zero or greater")
            resource = action("resource_show", id=args.resource_id)
            if resource.get("datastore_active") is not True:
                raise RuntimeError("This resource has no DataStore table. Inspect its URL and format with the dataset command.")
            result = action("datastore_search", resource_id=args.resource_id, limit=args.limit, offset=args.offset)
        else:
            result = catalog()

        rendered = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
        if args.command == "catalog" and args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding="utf-8")
            print(f"Saved {result['dataset_count']} datasets to {args.output}")
        else:
            print(rendered, end="")
        return 0
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
