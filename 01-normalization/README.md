# traefik_parser.py

Parses Traefik and legacy OpenCitations logs into a standardized CSV format with geographic data. Designed to make logs GDPR-friendly by replacing IPs with a salted SHA-1 hash and country info, and filtering out garbage tokens.

## Install

```bash
sudo apt install libmaxminddb0 libmaxminddb-dev
pip3 install orjson maxminddb
```

Download GeoLite2-Country.mmdb from MaxMind: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data

## Usage

```bash
# Salt is mandatory — pass it via --salt, env var, or edit SALT in the file
./traefik_parser.py --salt "mysecret" GeoLite2-Country.mmdb access.log > output.csv

# Or via environment variable
IP_HASH_SALT="mysecret" ./traefik_parser.py GeoLite2-Country.mmdb access.log > output.csv

# Works with .gz files
./traefik_parser.py --salt "mysecret" GeoLite2-Country.mmdb logs.gz > output.csv
```

If no salt is provided the script will exit with an error.

## Input Formats

**Traefik JSON:**
```json
{"ClientHost":"1.2.3.4","RequestMethod":"GET","RequestHost":"api.opencitations.net","RequestPath":"/index/v1/citations/10.1234/example","DownstreamStatus":200,"request_User-Agent":"curl/7.68.0","token":"a77255c3-3a39-4ce0-b4f6-9af9d67b5d94","time":"2025-05-01T12:00:00Z"}
```

## Output

CSV with these columns:
```
hashed_ip,continent_name,country_iso_code,country_name,request_method,request_host,request_path,http_response_code,user_agent,token,date,referer
```

Only `request_path`, `user_agent` and `referer` are quoted. Header is not quoted.

Example:
```csv
a1b2c3d4e5f67890a1b2c3d4e5f67890abcdef01,Europe,IT,Italy,GET,api.opencitations.net,"/index/v1/citations/10.1234",200,"curl/7.68.0",a77255c3-3a39-4ce0-b4f6-9af9d67b5d94,2025-05-01T12:00:00Z,"None"
```

## IP Hashing

IPs are replaced with a salted SHA-1 hash (40 hex characters). The salt is fixed across runs so the same IP always produces the same hash, allowing correlation between different months. An in-memory cache avoids recomputing hashes for repeated IPs within the same run.

Salt priority: `--salt` flag > `IP_HASH_SALT` env var > `SALT` constant in file.

## Token Filtering

Filters out:
- Basic Auth attempts: `Basic YWRtaW46YWRtaW4=` → `null`
- Empty tokens → `null`

All other tokens (including Bearer-prefixed) are kept as-is.

## GDPR Compliance

- Raw IP addresses not included in output
- IPs replaced with irreversible salted hash
- Geographic data aggregated to country level
- Bot authentication attempts (Basic Auth) filtered out

## Performance

Processes ~1M lines in 30-60 seconds. Uses ~100-200MB RAM. Progress updates every million lines to stderr.

## Notes

- Unknown geo data means IP couldn't be resolved (private ranges, invalid IPs, etc)
- Malformed lines are skipped
- Update GeoLite2 database monthly for best accuracy