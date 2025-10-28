import web
import os
import json
from src.wl import WebLogger
import requests
import subprocess
from os import path
import sys
import argparse
import re
from prometheus_client import Counter, CollectorRegistry, generate_latest, Gauge, Info
from prometheus_client.parser import text_fd_to_metric_families

# Load the configuration file
with open("conf.json") as f:
    c = json.load(f)


# Docker ENV variables
env_config = {
    "base_url": os.getenv("BASE_URL", c["base_url"]),
    "log_dir": os.getenv("LOG_DIR", c["log_dir"]),
    "stats_dir": os.getenv("STATS_DIR", c["stats_dir"]),
    "sync_enabled": os.getenv("SYNC_ENABLED", "false").lower() == "true"
}

active = {
    "corpus": "datasets",
    "index": "datasets",
    "meta": "datasets",
    "coci": "datasets",
    "doci": "datasets",
    "poci": "datasets",
    "croci": "datasets",
    "ccc": "datasets",
    "oci": "tools",
    "intrepid": "tools",
    "api": "querying",
    "sparql": "querying",
    "search": "querying"
}

# URL Mapping
urls = (
    "/", "Main",
    '/favicon.ico', 'Favicon',
    # Statistics
    "/statistics/(.+)", "Statistics"
)

# Set the web logger
web_logger = WebLogger(env_config["base_url"], env_config["log_dir"], [
    "HTTP_X_FORWARDED_FOR", # The IP address of the client
    "REMOTE_ADDR",          # The IP address of internal balancer
    "HTTP_USER_AGENT",      # The browser type of the visitor
    "HTTP_REFERER",         # The URL of the page that called your program
    "HTTP_HOST",            # The hostname of the page being attempted
    "REQUEST_URI",          # The interpreted pathname of the requested document
                            # or CGI (relative to the document root)
    "HTTP_AUTHORIZATION",   # Access token
    ],
    # comment this line only for test purposes
     {"REMOTE_ADDR": ["130.136.130.1", "130.136.2.47", "127.0.0.1"]}
)

render = web.template.render(c["html"], globals={
    'str': str,
    'isinstance': isinstance,
    'render': lambda *args, **kwargs: render(*args, **kwargs)
})

# App Web.py
app = web.application(urls, globals())

def sync_static_files():
    """
    Function to synchronize static files using sync_static.py
    """
    try:
        print("Starting static files synchronization...")
        subprocess.run([sys.executable, "sync_static.py", "--auto"], check=True)
        print("Static files synchronization completed")
    except subprocess.CalledProcessError as e:
        print(f"Error during static files synchronization: {e}")
    except Exception as e:
        print(f"Unexpected error during synchronization: {e}")


def clean_prometheus_output(content):
    """Remove _created metrics and convert values from scientific notation to integers"""
    filtered = []
    
    for line in content.split('\n'):
        # Skip _created metrics (internal Prometheus timestamps)
        if '_created' in line:
            continue
            
        # Convert scientific notation and floats to int
        if line and not line.startswith('#'):
            parts = line.rsplit(' ', 1)
            if len(parts) == 2:
                try:
                    val = float(parts[1])
                    # Convert to int if it doesn't lose precision
                    if abs(val - round(val)) < 0.001:  # threshold for rounding
                        line = parts[0] + ' ' + str(int(round(val)))
                except:
                    pass
        
        filtered.append(line)
    
    return '\n'.join(filtered)


class Favicon:
    def GET(self):
        is_https = web.ctx.env.get('HTTP_X_FORWARDED_PROTO') == 'https' or web.ctx.env.get('HTTPS') == 'on' or web.ctx.env.get('SERVER_PORT') == '443'
        raise web.seeother(f"{'https' if is_https else 'http'}://{web.ctx.host}/static/favicon.ico")

class Main:
    def GET(self):
        web_logger.mes()
        return render.statistics(active="", sp_title="", current_subdomain=web.ctx.host.split('.')[0].lower(), base_url=env_config["base_url"], render=render)

class Statistics:
    def __init__(self):
        self.__file_regex = re.compile(r'oc-(\d{4})-(\d{2})\.prom')
        self.__dates_regex = re.compile(r'(\d+)-(\d+)_(\d+)-(\d+)')

    def OPTIONS(self, date):
        org_ref = web.ctx.env.get('HTTP_REFERER')
        if org_ref and org_ref.endswith("/"):
            org_ref = org_ref[:-1]
        web.header('Access-Control-Allow-Origin', org_ref or "*")
        web.header('Access-Control-Allow-Credentials', 'true')
        web.header('Access-Control-Allow-Methods', '*')
        web.header('Access-Control-Allow-Headers', 'Authorization')

    def GET(self, date):
        web_logger.mes()
        org_ref = web.ctx.env.get('HTTP_REFERER')
        if org_ref and org_ref.endswith("/"):
            org_ref = org_ref[:-1]
        web.header('Access-Control-Allow-Origin', org_ref or "*")
        web.header('Access-Control-Allow-Credentials', 'true')
        web.header('Access-Control-Allow-Methods', '*')
        web.header('Access-Control-Allow-Headers', 'Authorization')

        file_path = ""

        if date != "last-month":
            if self.__dates_regex.match(date):
                search = self.__dates_regex.search(date)
                month_from, year_from = search.group(2), search.group(1)
                month_to, year_to = search.group(4), search.group(3)

                if year_from > year_to or (year_from == year_to and month_from > month_to):
                    raise web.HTTPError("400 ", {"Content-Type": "text/plain"}, "Bad date: ending before beginning")

                registry = CollectorRegistry()

                # Create all metrics
                metrics = {
                    'harvested_sources': Gauge('opencitations_harvested_data_sources', 'Harvested sources', registry=registry),
                    'indexed_records': Gauge('opencitations_indexed_records', 'Indexed records', registry=registry),
                    'api_requests': Counter('opencitations_api_requests', 'Total API requests', registry=registry),
                    'api_index_requests': Counter('opencitations_api_index_requests', 'Total INDEX API requests', registry=registry),
                    'api_index_by_version': Counter('opencitations_api_index_requests_by_version', 'INDEX API by version', ['version'], registry=registry),
                    'api_meta_requests': Counter('opencitations_api_meta_requests', 'Total META API requests', registry=registry),
                    'sparql_requests': Counter('opencitations_sparql_requests', 'Total SPARQL requests', registry=registry),
                    'search_requests': Counter('opencitations_search_requests', 'Total SEARCH requests', registry=registry),
                    'total_requests': Counter('opencitations_requests', 'Total HTTP requests', registry=registry),
                    'by_response_class': Counter('opencitations_requests_by_response_class', 'By response class', ['response_class'], registry=registry),
                    'by_method': Counter('opencitations_requests_by_method', 'By method', ['method'], registry=registry),
                    'by_status': Counter('opencitations_requests_by_status', 'By status', ['status'], registry=registry),
                    'by_country': Counter('opencitations_requests_by_country', 'By country', ['country', 'country_iso'], registry=registry),
                    'by_continent': Counter('opencitations_requests_by_continent', 'By continent', ['continent'], registry=registry),
                    'api_by_token': Counter('opencitations_api_requests_by_token', 'API by token', ['token'], registry=registry)
                }

                date_info = Info('opencitations_date', 'Date info', registry=registry)
                date_info.info({'month_from': month_from, 'year_from': year_from, 'month_to': month_to, 'year_to': year_to})

                # Aggregate monthly files
                current_month, current_year = int(month_from), int(year_from)
                target_month, target_year = int(month_to), int(year_to)

                while True:
                    while True:
                        month_str = str(current_month).zfill(2)
                        file_path = path.join(env_config["stats_dir"], f"oc-{current_year}-{month_str}.prom")
                        
                        if path.isfile(file_path):
                            with open(file_path, 'r') as f:
                                for family in text_fd_to_metric_families(f):
                                    for sample in family.samples:
                                        name, labels, value = sample[0], sample[1], sample[2]
                                        
                                        # Map metric names to counters
                                        mapping = {
                                            'opencitations_api_requests_total': ('api_requests', None),
                                            'opencitations_api_index_requests_total': ('api_index_requests', None),
                                            'opencitations_api_index_requests_by_version_total': ('api_index_by_version', labels),
                                            'opencitations_api_meta_requests_total': ('api_meta_requests', None),
                                            'opencitations_sparql_requests_total': ('sparql_requests', None),
                                            'opencitations_search_requests_total': ('search_requests', None),
                                            'opencitations_requests_total': ('total_requests', None),
                                            'opencitations_api_requests_by_token_total': ('api_by_token', labels),
                                            'opencitations_requests_by_response_class_total': ('by_response_class', labels),
                                            'opencitations_requests_by_method_total': ('by_method', labels),
                                            'opencitations_requests_by_status_total': ('by_status', labels),
                                            'opencitations_requests_by_country_total': ('by_country', labels),
                                            'opencitations_requests_by_continent_total': ('by_continent', labels),
                                            'opencitations_indexed_records': ('indexed_records', None),
                                            'opencitations_harvested_data_sources': ('harvested_sources', None)
                                        }
                                        
                                        if name in mapping:
                                            metric_key, metric_labels = mapping[name]
                                            metric = metrics[metric_key]
                                            
                                            if metric_labels:
                                                metric.labels(**metric_labels).inc(value)
                                            elif isinstance(metric, Gauge):
                                                metric.set(value)
                                            else:
                                                metric.inc(value)

                        if (current_year == target_year and current_month >= target_month) or current_month == 12:
                            break
                        current_month += 1

                    if current_year == target_year:
                        break
                    current_year += 1
                    current_month = 1

                return clean_prometheus_output(generate_latest(registry).decode('utf-8'))
            else:
                file_name = f"oc-{date}.prom"
                if self.__file_regex.match(file_name):
                    file_path = path.join(env_config["stats_dir"], file_name)
                    if not os.path.isfile(file_path):
                        file_path = ''
                else:
                    raise web.HTTPError("400 ", {"Content-Type": "text/plain"}, "Bad date format: use YYYY-MM or YYYY-MM_YYYY-MM")
        else:
            max_year = max_month = 0
            for file in os.listdir(env_config["stats_dir"]):
                if self.__file_regex.match(file):
                    year, month = map(int, self.__file_regex.search(file).groups())
                    if year > max_year or (year == max_year and month > max_month):
                        max_year, max_month = year, month
                        file_path = path.join(env_config["stats_dir"], file)

        if file_path:
            web.header('Content-Type', "text/plain")
            with open(file_path, 'r') as f:
                return clean_prometheus_output(f.read())
        else:
            raise web.HTTPError("404 ", {"Content-Type": "text/plain"}, "No statistics found")


# Run the application
if __name__ == "__main__":
    # Add startup log
    print("Starting STATISTICS OpenCitations web application...")
    print(f"Configuration: Base URL={env_config['base_url']}")
    print(f"Sync enabled: {env_config['sync_enabled']}")
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='STATISTICS OpenCitations web application')
    parser.add_argument(
        '--sync-static',
        action='store_true',
        help='synchronize static files at startup (for local testing or development)'
    )
    parser.add_argument(
        '--port',
        type=int,
        default=8080,
        help='port to run the application on (default: 8080)'
    )
    
    args = parser.parse_args()
    print(f"Starting on port: {args.port}")
    
    if args.sync_static or env_config["sync_enabled"]:
        # Run sync if either --sync-static is provided (local testing) 
        # or SYNC_ENABLED=true (Docker environment)
        print("Static sync is enabled")
        sync_static_files()
    else:
        print("Static sync is disabled")
    
    print("Starting web server...")
    # Set the port for web.py
    web.httpserver.runsimple(app.wsgifunc(), ("0.0.0.0", args.port))