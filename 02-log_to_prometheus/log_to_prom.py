#!/usr/bin/env python3
"""
Script to convert website logs to Prometheus format
"""

import csv
import sys
from collections import defaultdict, Counter
from datetime import datetime
import argparse
import gzip
import os
import requests
import xml.etree.ElementTree as ET
import threading

# Number of harvested data sources (update manually when needed)
data_sources = 9

def open_log_file(input_file):
    """
    Opens a regular or gzip-compressed file for reading text.
    """
    if input_file.endswith('.gz'):
        return gzip.open(input_file, 'rt', encoding='utf-8')
    else:
        return open(input_file, 'r', encoding='utf-8')

def get_indexed_records():
    """
    Calculate opencitations_indexed_records by making 3 SPARQL queries
    """
    # Fallback values
    fallback_citations = 2216426689
    fallback_expressions = 124526660
    fallback_agents = 341540052
    
    query1 = "PREFIX cito:<http://purl.org/spar/cito/>\nSELECT (COUNT(?citation) AS ?count) WHERE {\n    ?citation a cito:Citation .\n}"
    url1 = f"https://sparql.opencitations.net/index?query={requests.utils.quote(query1)}"
    
    query2 = "PREFIX fabio: <http://purl.org/spar/fabio/>\n\nSELECT (COUNT(?br) AS ?total)\nWHERE {\n  ?br a fabio:Expression .\n}"
    url2 = f"https://sparql.opencitations.net/meta?query={requests.utils.quote(query2)}"
    
    query3 = "SELECT (COUNT(?ra) as ?total) {\n      ?ra a <http://xmlns.com/foaf/0.1/Agent>.\n}"
    url3 = f"https://sparql.opencitations.net/meta?query={requests.utils.quote(query3)}"
    
    total = 0
    
    try:
        print("[SPARQL] 1. Querying citations from index...")
        try:
            response1 = requests.get(url1, timeout=600)
            root1 = ET.fromstring(response1.content)
            ns1 = {'sparql': 'http://www.w3.org/2005/sparql-results#'}
            value1 = int(root1.find('.//sparql:binding/sparql:literal', ns1).text)
            print(f"[SPARQL]    Citations: {value1}")
        except:
            value1 = fallback_citations
            print(f"[SPARQL]    Citations (fallback): {value1}")
        total += value1
        
        print("[SPARQL] 2. Querying expressions from meta...")
        try:
            response2 = requests.get(url2, timeout=600)
            root2 = ET.fromstring(response2.content)
            ns2 = {'sparql': 'http://www.w3.org/2005/sparql-results#'}
            value2 = int(root2.find('.//sparql:binding/sparql:literal', ns2).text)
            print(f"[SPARQL]    Expressions: {value2}")
        except:
            value2 = fallback_expressions
            print(f"[SPARQL]    Expressions (fallback): {value2}")
        total += value2
        
        print("[SPARQL] 3. Querying agents from meta...")
        try:
            response3 = requests.get(url3, timeout=600)
            root3 = ET.fromstring(response3.content)
            ns3 = {'sparql': 'http://www.w3.org/2005/sparql-results#'}
            value3 = int(root3.find('.//sparql:binding/sparql:literal', ns3).text)
            print(f"[SPARQL]    Agents: {value3}")
        except:
            value3 = fallback_agents
            print(f"[SPARQL]    Agents (fallback): {value3}")
        total += value3
        
        print(f"[SPARQL] Total indexed records: {total}")
        return total
        
    except Exception as e:
        print(f"[SPARQL] Error during SPARQL queries: {e}")
        fallback_total = fallback_citations + fallback_expressions + fallback_agents
        print(f"[SPARQL] Using fallback value: {fallback_total}")
        return fallback_total

def identify_service_old_format(host, path):
    """
    Identify service type for old format (pre-subdomains)
    Based on path patterns on opencitations.net
    """
    if host != 'opencitations.net':
        return None
    
    # SPARQL endpoints
    if path.startswith('/sparql') or path.startswith('/index/sparql') or path.startswith('/meta/sparql'):
        return 'sparql'
    
    # Search
    if path.startswith('/search'):
        return 'search'
    
    # API endpoints
    api_patterns = [
        '/index/api/v1/',
        '/index/api/v2/',
        '/meta/api/v1/',
        '/api/v1/',
        '/api/v2/'
    ]
    for pattern in api_patterns:
        if path.startswith(pattern):
            return 'api'
    
    # If none match, it's a dataset request (corpus, browser, etc)
    return 'dataset'

def identify_service_new_format(host):
    """
    Identify service type for new format (with subdomains)
    """
    if host == 'api.opencitations.net':
        return 'api'
    elif host == 'sparql.opencitations.net':
        return 'sparql'
    elif host == 'search.opencitations.net':
        return 'search'
    else:
        return 'dataset'

def get_api_version_old_format(path):
    """
    Extract API version from path in old format
    """
    if '/api/v1/' in path or '/index/api/v1/' in path:
        return 'v1'
    elif '/api/v2/' in path or '/index/api/v2/' in path:
        return 'v2'
    return None

def get_api_version_new_format(path):
    """
    Extract API version from path in new format
    """
    if path.startswith('/index/v1/'):
        return 'v1'
    elif path.startswith('/index/v2/'):
        return 'v2'
    return None

def is_meta_api_old_format(path):
    """
    Check if it's a META API request in old format
    """
    return path.startswith('/meta/api/v1/')

def is_meta_api_new_format(path):
    """
    Check if it's a META API request in new format
    """
    return path.startswith('/meta/v1')

def parse_log_file(input_file, output_file, old_format=False):
    """
    Reads the CSV log file and generates Prometheus metrics
    """
    # Increase CSV field size limit
    import sys
    maxInt = sys.maxsize
    while True:
        try:
            csv.field_size_limit(maxInt)
            break
        except OverflowError:
            maxInt = int(maxInt/10)
    
    # Extract year and month from filename (format: oc-YYYY-MM-gdpr.csv or similar)
    import re
    date_pattern = re.compile(r'(\d{4})-(\d{2})')
    date_match = date_pattern.search(os.path.basename(input_file))
    
    if date_match:
        year = date_match.group(1)
        month = date_match.group(2)
        print(f"Extracted date from filename: Year={year}, Month={month}")
    else:
        from datetime import datetime
        now = datetime.now()
        year = str(now.year)
        month = str(now.month).zfill(2)
        print(f"Could not extract date from filename, using current date: Year={year}, Month={month}")
    
    # Start SPARQL queries in a separate thread
    print("\n=== STARTING PARALLEL PROCESSING ===")
    print("[SPARQL] Starting SPARQL queries in background thread...")
    print("[CSV] Starting CSV parsing in main thread...\n")
    
    indexed_records_result = [None]
    
    def sparql_thread():
        indexed_records_result[0] = get_indexed_records()
    
    sparql_worker = threading.Thread(target=sparql_thread)
    sparql_worker.start()
    
    # Counters
    request_methods = Counter()
    response_codes = Counter()
    countries = Counter()
    continents = Counter()

    api_total = 0
    api_index_total = 0
    api_index_v1 = 0
    api_index_v2 = 0
    api_meta_total = 0
    sparql_total = 0
    search_total = 0

    tokens_set = set()
    api_tokens = Counter()

    response_200 = 0
    response_301 = 0
    response_404 = 0

    total_requests = 0
    malformed_lines = 0

    print(f"[CSV] Reading file: {input_file}")
    print(f"[CSV] Format: {'OLD (path-based)' if old_format else 'NEW (subdomain-based)'}")

    try:
        with open_log_file(input_file) as f:
            csv_reader = csv.reader(f)

            header = next(csv_reader, None)
            if header is None:
                print("[CSV] Error: Empty file")
                return

            print(f"[CSV] Header found: {len(header)} columns")

            for line_num, row in enumerate(csv_reader, start=2):
                try:
                    if line_num % 1000000 == 0:
                        print(f"[CSV] Processed {line_num} lines...")
                    
                    if len(row) > 10:
                        malformed_lines += 1
                        print(f"[CSV] Line {line_num} skipped: {len(row)} columns (malformed)")
                        continue

                    if len(row) < 10:
                        malformed_lines += 1
                        continue

                    try:
                        continent = row[0].strip()
                        country_iso = row[1].strip()
                        country_name = row[2].strip()
                        method = row[3].strip()
                        host = row[4].strip()
                        path = row[5].strip()
                        response_code = row[6].strip()
                        user_agent = row[7].strip()
                        token = row[8].strip()
                        date = row[9].strip()

                        total_requests += 1
                        request_methods[method] += 1
                        response_codes[response_code] += 1
                        countries[country_name] += 1
                        continents[continent] += 1

                        # Track unique tokens (exclude null and placeholders)
                        if (token and token.strip() and 
                            token.lower() != 'null' and 
                            token != 'YOUR-TOKEN-HERE' and 
                            token != 'YOUR-OPENCITATIONS-ACCESS-TOKEN'):
                            tokens_set.add(token)

                        # Identify service type based on format
                        if old_format:
                            service = identify_service_old_format(host, path)
                        else:
                            service = identify_service_new_format(host)

                        # Count by service type
                        if service == 'api':
                            api_total += 1

                            # Track API hits per token (exclude placeholders)
                            if (token and token.strip() and 
                                token.lower() != 'null' and 
                                token != 'YOUR-TOKEN-HERE' and 
                                token != 'YOUR-OPENCITATIONS-ACCESS-TOKEN'):
                                api_tokens[token] += 1

                            # Determine if it's INDEX or META
                            if old_format:
                                is_meta = is_meta_api_old_format(path)
                                if is_meta:
                                    api_meta_total += 1
                                else:
                                    # INDEX API
                                    version = get_api_version_old_format(path)
                                    api_index_total += 1
                                    if version == 'v1':
                                        api_index_v1 += 1
                                    elif version == 'v2':
                                        api_index_v2 += 1
                            else:
                                is_meta = is_meta_api_new_format(path)
                                if is_meta:
                                    api_meta_total += 1
                                else:
                                    # INDEX API
                                    version = get_api_version_new_format(path)
                                    api_index_total += 1
                                    if version == 'v1':
                                        api_index_v1 += 1
                                    elif version == 'v2':
                                        api_index_v2 += 1

                        elif service == 'sparql':
                            sparql_total += 1
                        elif service == 'search':
                            search_total += 1

                        if response_code == "200":
                            response_200 += 1
                        elif response_code == "301":
                            response_301 += 1
                        elif response_code == "404":
                            response_404 += 1

                    except (IndexError, ValueError) as e:
                        malformed_lines += 1
                        print(f"[CSV] Error in line {line_num}: {e}")
                        continue
                
                except csv.Error as e:
                    malformed_lines += 1
                    print(f"[CSV] CSV error in line {line_num}: {e} - skipping row")
                    continue

    except FileNotFoundError:
        print(f"[CSV] Error: File {input_file} not found")
        return
    except Exception as e:
        print(f"[CSV] Error while reading the file: {e}")
        return

    print(f"[CSV] Processed {total_requests} valid lines, {malformed_lines} lines skipped")

    # Count unique tokens (exclude placeholders)
    excluded_tokens = {'null', 'YOUR-TOKEN-HERE', 'YOUR-OPENCITATIONS-ACCESS-TOKEN'}
    unique_tokens_count = sum(1 for token in api_tokens.keys() 
                              if token.lower() not in [t.lower() for t in excluded_tokens] and token not in excluded_tokens)

    dataset_total_count = sparql_total + search_total

    # Wait for SPARQL queries to complete
    print("\n[CSV] CSV parsing completed!")
    print("[SPARQL] Waiting for SPARQL queries to complete...")
    sparql_worker.join()
    indexed_records = indexed_records_result[0]
    print("[SPARQL] SPARQL queries completed!\n")

    print("\n=== API STATISTICS ===")
    print(f"Total API requests: {api_total}")
    print(f"  - Total INDEX: {api_index_total}")
    print(f"    - INDEX v1: {api_index_v1}")
    print(f"    - INDEX v2: {api_index_v2}")
    print(f"  - META v1: {api_meta_total}")

    print("\n=== TOKEN STATISTICS ===")
    print(f"Total unique tokens: {unique_tokens_count}")
    print(f"\nTop 20 API users by token:")
    for i, (token, count) in enumerate(api_tokens.most_common(20), 1):
        print(f"  {i}. Token {token}: {count} hits")

    print("\n=== SPARQL STATISTICS ===")
    print(f"Total SPARQL requests: {sparql_total}")

    print("\n=== SEARCH STATISTICS ===")
    print(f"Total SEARCH requests: {search_total}")

    print("\n=== DATASET TOTAL (SPARQL + SEARCH) ===")
    print(f"Total dataset requests: {dataset_total_count}")

    print("\n=== RESPONSE CLASSES ===")
    print(f"200 (Success): {response_200}")
    print(f"301 (Redirect): {response_301}")
    print(f"404 (Not Found): {response_404}")
    print()

    generate_prometheus_file(
        output_file, total_requests, request_methods, response_codes,
        countries, continents, api_total, api_index_total,
        api_index_v1, api_index_v2, api_meta_total, sparql_total,
        search_total, dataset_total_count,
        unique_tokens_count, api_tokens,
        indexed_records,
        data_sources,
        year, month,
        response_200, response_301, response_404
    )

def generate_prometheus_file(output_file, total_requests, request_methods,
                           response_codes, countries, continents, api_total, api_index_total,
                           api_index_v1, api_index_v2, api_meta_total, sparql_total,
                           search_total, dataset_total_count,
                           unique_tokens_count, api_tokens,
                           indexed_records,
                           data_sources,
                           year, month,
                           response_200, response_301, response_404):
    """
    Generates the Prometheus format file
    """
    print(f"\n=== GENERATING PROMETHEUS FILE ===")
    print(f"Output file: {output_file}")

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("# HELP opencitations_requests_total Total number of HTTP requests\n")
            f.write("# TYPE opencitations_requests_total counter\n")
            f.write(f"opencitations_requests_total {total_requests}\n\n")

            # API metrics
            f.write("# HELP opencitations_api_requests_total Total API requests\n")
            f.write("# TYPE opencitations_api_requests_total counter\n")
            f.write(f"opencitations_api_requests_total {api_total}\n\n")

            f.write("# HELP opencitations_api_index_requests_total Total INDEX API requests\n")
            f.write("# TYPE opencitations_api_index_requests_total counter\n")
            f.write(f"opencitations_api_index_requests_total {api_index_total}\n\n")

            f.write("# HELP opencitations_api_index_requests_by_version_total INDEX API requests by version\n")
            f.write("# TYPE opencitations_api_index_requests_by_version_total counter\n")
            f.write(f'opencitations_api_index_requests_by_version_total{{version="v1"}} {api_index_v1}\n')
            f.write(f'opencitations_api_index_requests_by_version_total{{version="v2"}} {api_index_v2}\n\n')

            f.write("# HELP opencitations_api_meta_requests_total Total META API requests\n")
            f.write("# TYPE opencitations_api_meta_requests_total counter\n")
            f.write(f"opencitations_api_meta_requests_total {api_meta_total}\n\n")

            # SPARQL metrics
            f.write("# HELP opencitations_sparql_requests_total Total SPARQL requests\n")
            f.write("# TYPE opencitations_sparql_requests_total counter\n")
            f.write(f"opencitations_sparql_requests_total {sparql_total}\n\n")

            # Search metrics
            f.write("# HELP opencitations_search_requests_total Total SEARCH requests\n")
            f.write("# TYPE opencitations_search_requests_total counter\n")
            f.write(f"opencitations_search_requests_total {search_total}\n\n")

            # Dataset total count
            f.write("# HELP opencitations_dataset_total_count Total dataset requests (SPARQL + SEARCH)\n")
            f.write("# TYPE opencitations_dataset_total_count counter\n")
            f.write(f"opencitations_dataset_total_count {dataset_total_count}\n\n")

            # Indexed records
            f.write("# HELP opencitations_indexed_records Total indexed records (Citations + Expressions + Agents)\n")
            f.write("# TYPE opencitations_indexed_records gauge\n")
            f.write(f"opencitations_indexed_records {indexed_records}\n\n")

            # Harvested data sources
            f.write("# HELP opencitations_harvested_data_sources Number of harvested data sources\n")
            f.write("# TYPE opencitations_harvested_data_sources gauge\n")
            f.write(f"opencitations_harvested_data_sources {data_sources}.0\n\n")

            # Date info
            f.write("# HELP opencitations_date_info Date information for the statistics\n")
            f.write("# TYPE opencitations_date_info gauge\n")
            f.write(f'opencitations_date_info{{month="{month}",year="{year}"}} 1.0\n\n')

            # Token metrics
            f.write("# HELP opencitations_unique_tokens_total Total number of unique tokens\n")
            f.write("# TYPE opencitations_unique_tokens_total gauge\n")
            f.write(f"opencitations_unique_tokens_total {unique_tokens_count}\n\n")

            # API requests by token (all tokens, excluding placeholders)
            f.write("# HELP opencitations_api_requests_by_token_total API requests by token (all users)\n")
            f.write("# TYPE opencitations_api_requests_by_token_total counter\n")
            excluded_tokens = {'null', 'YOUR-TOKEN-HERE', 'YOUR-OPENCITATIONS-ACCESS-TOKEN'}
            for token, count in api_tokens.items():
                if token.lower() in [t.lower() for t in excluded_tokens] or token in excluded_tokens:
                    continue
                token_escaped = token.replace('"', '\\"').replace('\\', '\\\\')
                f.write(f'opencitations_api_requests_by_token_total{{token="{token_escaped}"}} {count}\n')
            f.write("\n")

            # Response classes
            f.write("# HELP opencitations_requests_by_response_class_total HTTP requests by response class\n")
            f.write("# TYPE opencitations_requests_by_response_class_total counter\n")
            f.write(f'opencitations_requests_by_response_class_total{{response_class="200"}} {response_200}\n')
            f.write(f'opencitations_requests_by_response_class_total{{response_class="301"}} {response_301}\n')
            f.write(f'opencitations_requests_by_response_class_total{{response_class="404"}} {response_404}\n\n')

            # HTTP methods
            f.write("# HELP opencitations_requests_by_method_total HTTP requests by method\n")
            f.write("# TYPE opencitations_requests_by_method_total counter\n")
            for method, count in request_methods.items():
                f.write(f'opencitations_requests_by_method_total{{method="{method}"}} {count}\n')
            f.write("\n")

            # Response codes
            f.write("# HELP opencitations_requests_by_status_total HTTP requests by status code\n")
            f.write("# TYPE opencitations_requests_by_status_total counter\n")
            for code, count in response_codes.items():
                f.write(f'opencitations_requests_by_status_total{{status="{code}"}} {count}\n')
            f.write("\n")

            # Countries (top 20)
            f.write("# HELP opencitations_requests_by_country_total HTTP requests by country\n")
            f.write("# TYPE opencitations_requests_by_country_total counter\n")
            for country, count in countries.most_common(20):
                country_escaped = country.replace('"', '\\"')
                f.write(f'opencitations_requests_by_country_total{{country="{country_escaped}"}} {count}\n')
            f.write("\n")

            # Continents
            f.write("# HELP opencitations_requests_by_continent_total HTTP requests by continent\n")
            f.write("# TYPE opencitations_requests_by_continent_total counter\n")
            for continent, count in continents.items():
                f.write(f'opencitations_requests_by_continent_total{{continent="{continent}"}} {count}\n')
            f.write("\n")

    except Exception as e:
        print(f"Error while generating Prometheus file: {e}")
        return

    print("Prometheus file generated successfully!\n")

def main():
    parser = argparse.ArgumentParser(
        description='Converts website logs to Prometheus format for statistic-view'
    )
    parser.add_argument('input_file', help='Input CSV log file (can be .gz)')
    parser.add_argument('-o', '--output', default='prometheus_metrics.txt',
                       help='Prometheus output file (default: prometheus_metrics.txt)')
    parser.add_argument('--old', action='store_true',
                       help='Parse old format logs (pre-subdomains, path-based service detection)')

    args = parser.parse_args()

    parse_log_file(args.input_file, args.output, old_format=args.old)

if __name__ == "__main__":
    main()