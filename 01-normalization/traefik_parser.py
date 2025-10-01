#!/usr/bin/env python3
import sys
import gzip
import orjson
import maxminddb

CHUNK_SIZE = 8 * 1024 * 1024  # 8MB per blocco
PROGRESS_STEP = 1_000_000     # report ogni milione di righe


def count_lines(path: str) -> int:
    total = 0
    if path.endswith(".gz"):
        with gzip.open(path, "rb") as f:
            while chunk := f.read(CHUNK_SIZE):
                total += chunk.count(b"\n")
    else:
        with open(path, "rb") as f:
            while chunk := f.read(CHUNK_SIZE):
                total += chunk.count(b"\n")
    return total


def process(mmdb_path: str, infile: str):
    try:
        reader = maxminddb.open_database(mmdb_path)
    except Exception as e:
        sys.stderr.write(f"Errore apertura MMDB: {e}\n")
        return 1

    total_lines = count_lines(infile)
    if total_lines == 0:
        sys.stderr.write("File vuoto o non trovato.\n")
        return 1

    if infile.endswith(".gz"):
        f = gzip.open(infile, "rb")
    else:
        f = open(infile, "rb")

    out = sys.stdout.buffer
    out.write(
        b"continent_name,country_iso_code,country_name,request_method,request_host,request_path,http_response_code,user_agent,token,date\n"
    )

    processed = 0
    buf = b""

    while True:
        chunk = f.read(CHUNK_SIZE)
        if not chunk:
            break
        buf += chunk
        parts = buf.split(b"\n")
        buf = parts.pop()

        for line in parts:
            if not line:
                processed += 1
                continue
            try:
                obj = orjson.loads(line)
            except Exception:
                processed += 1
                continue

            ip = obj.get("ClientHost", "")
            method = obj.get("RequestMethod", "")
            host = obj.get("RequestHost", "")
            path = obj.get("RequestPath", "")
            code = str(obj.get("DownstreamStatus", ""))
            agent = obj.get("request_User-Agent", "") or obj.get("request_user-agent", "") or ""
            token = obj.get("token", obj.get("request_Authorization", "null")) or "null"
            date = obj.get("time", "")

            # geo lookup
            try:
                geo = reader.get(ip)
                if not geo:
                    continent, iso, cname = "Unknown", "XX", "Unknown"
                else:
                    continent = geo.get("continent", {}).get("names", {}).get("en", "Unknown")
                    iso = geo.get("country", {}).get("iso_code", "XX")
                    cname = geo.get("country", {}).get("names", {}).get("en", "Unknown")
            except Exception:
                continent, iso, cname = "Unknown", "XX", "Unknown"

            path = str(path).replace('"', '""')
            agent = str(agent).replace('"', '""')

            line_out = (
                f'{continent},{iso},{cname},{method},{host},"{path}",{code},"{agent}",{token},{date}\n'
            ).encode("utf-8", "replace")
            out.write(line_out)

            processed += 1
            if processed % PROGRESS_STEP == 0:
                perc = processed / total_lines * 100.0
                sys.stderr.write(f"\rElaborate {processed}/{total_lines} righe ({perc:.2f}%)")
                sys.stderr.flush()

    if buf:
        try:
            obj = orjson.loads(buf)
            ip = obj.get("ClientHost", "")
            method = obj.get("RequestMethod", "")
            host = obj.get("RequestHost", "")
            path = obj.get("RequestPath", "")
            code = str(obj.get("DownstreamStatus", ""))
            agent = obj.get("request_User-Agent", "") or ""
            token = obj.get("token", obj.get("request_Authorization", "null")) or "null"
            date = obj.get("time", "")

            geo = reader.get(ip) or {}
            continent = geo.get("continent", {}).get("names", {}).get("en", "Unknown")
            iso = geo.get("country", {}).get("iso_code", "XX")
            cname = geo.get("country", {}).get("names", {}).get("en", "Unknown")

            path = str(path).replace('"', '""')
            agent = str(agent).replace('"', '""')

            line_out = (
                f'{continent},{iso},{cname},{method},{host},"{path}",{code},"{agent}",{token},{date}\n'
            ).encode("utf-8", "replace")
            out.write(line_out)
        except Exception:
            pass

    sys.stderr.write("\nCompletato!\n")
    f.close()
    reader.close()
    return 0


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("Usage: traefik_parser.py <GeoLite2-Country.mmdb> <traefik.log[.gz]>\n")
        return 2
    return process(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    raise SystemExit(main())