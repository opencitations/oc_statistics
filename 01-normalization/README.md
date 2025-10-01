# traefik_parser.py

Parses Traefik and legacy OpenCitations logs into a standardized CSV format with geographic data. Designed to make logs GDPR-friendly by replacing IPs with country info and filtering out garbage tokens.

## Install

```bash
sudo apt install libmaxminddb0 libmaxminddb-dev
pip3 install orjson maxminddb
```

Download GeoLite2-Country.mmdb from MaxMind: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data

## Usage

```bash
# Traefik JSON logs
./traefik_parser.py GeoLite2-Country.mmdb access.log > output.csv

# Legacy format
./traefik_parser.py --old GeoLite2-Country.mmdb old_logs.txt > output.csv

# Works with .gz files
./traefik_parser.py GeoLite2-Country.mmdb logs.gz > output.csv
```

## Input Formats

**Traefik JSON:**
```json
{"ClientHost":"1.2.3.4","RequestMethod":"GET","RequestHost":"api.opencitations.net","RequestPath":"/index/v1/citations/10.1234/example","DownstreamStatus":200,"request_User-Agent":"curl/7.68.0","token":"a77255c3-3a39-4ce0-b4f6-9af9d67b5d94","time":"2025-05-01T12:00:00Z"}
```

**Legacy (with --old):**
```
2025-05-01 00:00:00,155 # REMOTE_ADDR: 1.2.3.4 # HTTP_USER_AGENT: curl/7.68.0 # HTTP_HOST: opencitations.net # REQUEST_URI: /index/api/v1/references/10.1234/example # HTTP_AUTHORIZATION: a77255c3-3a39-4ce0-b4f6-9af9d67b5d94
```

Legacy dates get converted to ISO format automatically.

## Output

CSV with these columns:
```
continent_name,country_iso_code,country_name,request_method,request_host,request_path,http_response_code,user_agent,token,date
```

Only `request_path` and `user_agent` are quoted. Header is not quoted.

Example:
```csv
Europe,IT,Italy,GET,api.opencitations.net,"/index/v1/citations/10.1234",200,"curl/7.68.0",a77255c3-3a39-4ce0-b4f6-9af9d67b5d94,2025-05-01T12:00:00Z
```

## Token Filtering

Keeps only valid API tokens (UUID format, 8+ chars, alphanumeric with hyphens/underscores).

Filters out:
- Basic Auth attempts: `Basic YWRtaW46YWRtaW4=` → `null`
- Malformed tokens → `null`
- Empty tokens → `null`
- Strips `Bearer` prefix if present

This removes bot probing and keeps real API usage.

## GDPR Compliance

- IP addresses not included in output
- Geographic data aggregated to country level
- Bot authentication attempts filtered out
- Only legitimate API tokens preserved

## Performance

Processes ~1M lines in 30-60 seconds. Uses ~100-200MB RAM. Progress updates every million lines to stderr.

## Notes

- Unknown geo data means IP couldn't be resolved (private ranges, invalid IPs, etc)
- Malformed lines are skipped
- Update GeoLite2 database monthly for best accuracy