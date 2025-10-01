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


# Process favicon.ico requests
class Favicon:
    def GET(self):
        is_https = (
            web.ctx.env.get('HTTP_X_FORWARDED_PROTO') == 'https' or
            web.ctx.env.get('HTTPS') == 'on' or
            web.ctx.env.get('SERVER_PORT') == '443'
        )
        protocol = 'https' if is_https else 'http'
        raise web.seeother(f"{protocol}://{web.ctx.host}/static/favicon.ico")

class Main:
    def GET(self):
        web_logger.mes()
        current_subdomain = web.ctx.host.split('.')[0].lower()
        return render.statistics(active="", sp_title="", current_subdomain=current_subdomain, base_url=env_config["base_url"],  render=render)
    
class Statistics:
    def __init__(self):
        self.__file_regex = re.compile(r'oc-(\d{4})-(\d{2})\.prom')
        self.__dates_regex = re.compile(r'(\d+)-(\d+)_(\d+)-(\d+)')

    def OPTIONS(self, date):
        # remember to remove the slash at the end
        org_ref = web.ctx.env.get('HTTP_REFERER')
        if org_ref is not None:
            if org_ref.endswith("/"):
                org_ref = org_ref[:-1]
        else:
            org_ref = "*"
        web.header('Access-Control-Allow-Origin', org_ref)
        web.header('Access-Control-Allow-Credentials', 'true')
        web.header('Access-Control-Allow-Methods', '*')
        web.header('Access-Control-Allow-Headers', 'Authorization')



    def GET(self, date):
        #validateAccessToken()
        web_logger.mes()
        file_path = ""

        # Allow origin
        # remember to remove the slash at the end
        # remember to remove the slash at the end
        org_ref = web.ctx.env.get('HTTP_REFERER')
        if org_ref is not None:
            if org_ref.endswith("/"):
                org_ref = org_ref[:-1]
        else:
            org_ref = "*"

        web.header('Access-Control-Allow-Origin', org_ref)
        web.header('Access-Control-Allow-Credentials', 'true')
        web.header('Access-Control-Allow-Methods', '*')
        web.header('Access-Control-Allow-Headers', 'Authorization')

        # checks if any date has been specified, otherwise looks for the most recent statistics
        if(date != "last-month"):
            if self.__dates_regex.match(date):
                search = self.__dates_regex.search(date)

                month_from = search.group(2)
                year_from = search.group(1)
                month_to = search.group(4)
                year_to = search.group(3)

                if year_from > year_to or (year_from == year_to and month_from > month_to):
                    raise web.HTTPError(
                        "400 ",
                        {
                            "Content-Type": "text/plain"
                        },
                        "Bad date provided, the ending date is lower than the beginning date."
                    )

                registry = CollectorRegistry()

                # Counter of accesses to different endpoints oc
                http_requests = Counter(
                    'opencitations_http_requests',
                    'Counter for HTTP requests to opencitations endpoints',
                    ['endpoint'],
                    registry=registry
                )

                # Aggregate counter of accesses to the different categories of endpoints oc
                agg_counter = Counter(
                    'opencitations_agg_counter',
                    'Aggregate HTTP requests counter to opencitations endpoints',
                    ['category'],
                    registry=registry
                )
                i = Info(
                    'opencitations_date',
                    'Date to which the statistics refers to',
                    registry=registry
                )
                i.info({'month_from': str(month_from), 'year_from': str(
                    year_from), "month_to": str(month_to), 'year_to': str(year_to)})

                indexed_records = Gauge(
                    'opencitations_indexed_records',
                    'Indexed records',
                    registry=registry
                )
                harvested_data_sources = Gauge(
                    'opencitations_harvested_data_sources',
                    'Harvested data sources',
                    registry=registry
                )

                current_month = int(month_from)
                current_year = int(year_from)
                target_month = int(month_to)
                target_year = int(year_to)

                while(True):
                    # For each month collects the statistics and adds
                    # them to the ones to be returned.
                    while(True):
                        current_month_str = str(current_month)
                        if len(current_month_str) == 1:
                            current_month_str = '0' + current_month_str
                        file_path = path.join(
                            env_config["stats_dir"], "oc-" + str(current_year) + "-" + current_month_str + ".prom")
                        if path.isfile(file_path):
                            f = open(file_path, 'r')
                            families = text_fd_to_metric_families(f)
                            for family in families:
                                for sample in family.samples:
                                    if sample[0] == "opencitations_agg_counter_total":
                                        agg_counter.labels(
                                            **sample[1]).inc(sample[2])
                                    if sample[0] == "opencitations_http_requests_total":
                                        http_requests.labels(
                                            **sample[1]).inc(sample[2])
                                    if sample[0] == "opencitations_indexed_records":
                                        indexed_records.set(sample[2])
                                    if sample[0] == "opencitations_harvested_data_sources":
                                        harvested_data_sources.set(sample[2])

                        # If we reaches the target year and the month we are visiting is the last one
                        # or if we visited the whole year i.e. the last month has just been visited
                        # exit the months's loop
                        if (current_year == target_year and current_month >= target_month) or current_month == 12:
                            break
                        current_month += 1

                    # If we visited all the years than we exit the years's loop
                    if(current_year == target_year):
                        break
                    current_year += 1
                    current_month = 1

                return generate_latest(registry)
            else:
                file_name = "oc-" + date + ".prom"
                if self.__file_regex.match(file_name):
                    file_path = path.join(env_config["stats_dir"], file_name)
                    if not os.path.isfile(file_path):
                        file_path = ''
                else:
                    raise web.HTTPError(
                        "400 ",
                        {
                            "Content-Type": "text/plain"
                        },
                        "Bad date format the required one is: year-month or year-month_year-month."
                    )
        else:
            max_year = 0
            max_month = 0
            for file in os.listdir(env_config["stats_dir"]):
                if self.__file_regex.match(file):
                    groups = self.__file_regex.search(file).groups()
                    # checks that the file respects the format in the name
                    year = int(groups[0])
                    month = int(groups[1])
                    if year > max_year or (year == max_year and month > max_month):
                        max_year = year
                        max_month = month
                        file_path = os.path.join(env_config["stats_dir"], file)

        # if the statistics file was found then it returns the content
        if file_path != "":
            web.header('Content-Type', "text/plain")
            f = open(file_path, 'r')
            content = f.read()
            f.close()
            web.ctx.status = '200 OK'
            return content
        else:
            raise web.HTTPError(
                "404 ",
                {
                    "Content-Type": "text/plain"
                },
                "No statistics found."
            )


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