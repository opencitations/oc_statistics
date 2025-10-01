# log_to_prom.py

Converts GDPR-friendly CSV logs (output from traefik_parser.py) into Prometheus metrics format.

## Install

```bash
pip3 install requests
```

## Usage

```bash
# New format (subdomain-based)
./log_to_prom.py input.csv -o metrics.prom

# Old format (path-based, pre-2023)
./log_to_prom.py --old input.csv -o metrics.prom
```

## Format Detection

**New format** (current): Service identified by subdomain
- `api.opencitations.net` → API requests
- `sparql.opencitations.net` → SPARQL
- `search.opencitations.net` → Search
- Other hosts → Dataset requests

**Old format** (with `--old`): Service identified by path on opencitations.net
- `/sparql`, `/index/sparql`, `/meta/sparql` → SPARQL
- `/search` → Search
- `/api/v1/`, `/index/api/v1/`, `/meta/api/v1/` → API
- Everything else → Dataset requests

## Generated Metrics

- Total requests by service (API, SPARQL, Search, Dataset)
- API breakdown: INDEX v1/v2, META
- Requests by country (top 20)
- Requests by continent
- Response codes (200, 301, 404, all)
- HTTP methods
- Unique API tokens
- Per-token request counts
- Indexed records (from SPARQL queries)

## Output

Prometheus text format (`.prom`):
```
opencitations_api_requests_total 12345
opencitations_api_index_requests_by_version_total{version="v1"} 8000
opencitations_api_index_requests_by_version_total{version="v2"} 3000
opencitations_requests_by_country_total{country="United States"} 5000
...
```

Compatible with statistics_oc.py for visualization.

## Date Extraction

Script tries to extract date from filename (e.g., `logs-2025-03.csv` → March 2025).
Falls back to current date if pattern not found.

## SPARQL Queries

On startup, queries opencitations.net SPARQL endpoints to get:
- Total citations (from index)
- Total expressions (from meta)
- Total agents (from meta)

Runs in parallel with log parsing. Uses fallback values if queries fail.

## Performance

~10-20 seconds per million log lines. Memory usage ~100-200MB.

## Notes

- Input must be CSV from traefik_parser.py
- Tokens filtered: only counts valid API tokens, ignores null/placeholders
- Date in filename should be YYYY-MM format for automatic extraction
- SPARQL queries can take 5-10 minutes, script continues parsing while waiting