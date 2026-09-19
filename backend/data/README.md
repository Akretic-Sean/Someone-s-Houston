# Houston data inventory

`houston-catalog.json` is a dated snapshot of public dataset metadata: titles, resource IDs, formats, download URLs, and license metadata. It contains no downloaded source records. Refresh it from the repository root:

```sh
python backend/tools/houston_data.py catalog --output backend/data/houston-catalog.json
```

Use this inventory to choose resources after the build plan arrives. A dataset may mix CSV files, spreadsheets, GIS services, PDFs, videos, and dashboards. Only resources marked `datastore_active: true` can be sampled through the CKAN DataStore API.

Store local downloads in `raw/`, which Git ignores. Preserve the source dataset/resource IDs, source timestamp, retrieval timestamp, and attribution when importing selected records into Supabase.
