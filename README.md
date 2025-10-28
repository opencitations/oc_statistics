# OpenCitations STATISTICS Service

This repository contains the STATISTICS service for OpenCitations.

## Normalization and Prometheus Export Scripts

Scripts for log normalization and Prometheus metrics export are available in the `scripts` branch of this repository.

To use these scripts, switch to the `scripts` branch.

## Scripts for normalization and prom
You can find them on the scripts branch.

### Environment Variables

The service requires the following environment variables. These values take precedence over the ones defined in `conf.json`:

- `BASE_URL`: Base URL for the statistics endpoint
- `LOG_DIR`: Directory path where log files will be stored
- `SYNC_ENABLED`: Enable/disable static files synchronization (default: false)

For instance:

```env
BASE_URL=statistics.opencitations.net
LOG_DIR=/home/dir/log/
SYNC_ENABLED=true
```

> **Note**: When running with Docker, environment variables always override the corresponding values in `conf.json`. If an environment variable is not set, the application will fall back to the values defined in `conf.json`.

### Static Files Synchronization

The application can synchronize static files from a GitHub repository. This configuration is managed in `conf.json`:

```json
{
  [...]
  "oc_services_templates": "https://github.com/opencitations/oc_services_templates",
  "sync": {
    "folders": [
      "static",
      "html-template/common"
    ],
    "files": [
      "test.txt"
    ]
  }
}
```

- `oc_services_templates`: The GitHub repository URL to sync files from
- `sync.folders`: List of folders to synchronize
- `sync.files`: List of individual files to synchronize

When static sync is enabled (via `--sync-static` or `SYNC_ENABLED=true`), the application will:
1. Clone the specified repository
2. Copy the specified folders and files
3. Keep the local static files up to date

> **Note**: Make sure the specified folders and files exist in the source repository.

## Running Options

### Local development
For local development and testing, the application uses the built-in web.py HTTP server.

The application supports the following command line arguments:

- `--sync-static`: Synchronize static files at startup and enable periodic sync (every 30 minutes)
- `--port PORT`: Specify the port to run the application on (default: 8080)

Examples:
```bash
# Run with default settings
python3 statistics_oc.py

# Run with static sync enabled
python3 statistics_oc.py --sync-static

# Run on custom port
python3 statistics_oc.py --port 8085

# Run with both options
python3 statistics_oc.py --sync-static --port 8085
```

The Docker container is configured to run with `--sync-static` enabled by default.

### Production Deployment (Docker)
You can customize the Gunicorn server configuration by modifying the `gunicorn.conf.py` file.

- **Server**: Gunicorn with gevent workers
- **Workers**: 4 concurrent worker processes
- **Worker Type**: gevent (async) for handling thousands of simultaneous requests
- **Timeout**: 1000 seconds (to handle long-running SPARQL queries)
- **Connections per worker**: 1000 simultaneous connections

The Docker container automatically uses Gunicorn and is configured with static sync enabled by default.

> **Note**: The application code automatically detects the execution environment. When run with `python3 statistics_oc.py`, it uses the built-in web.py server. When run with Gunicorn (as in Docker), it uses the WSGI interface.

### Dockerfile

You can change these variables in the Dockerfile:

```dockerfile
# Base image: Python slim for a lightweight container
FROM python:3.11-slim

# Define environment variables with default values
# These can be overridden during container runtime
ENV BASE_URL="statistics.opencitations.net" \
    SYNC_ENABLED="true" \
    STATS_DIR="/mnt/public_logs/prom" \
    LOG_DIR="/mnt/log_dir/oc_statistics"


# Ensure Python output is unbuffered
ENV PYTHONUNBUFFERED=1

# Install system dependencies required for Python package compilation
# We clean up apt cache after installation to reduce image size
RUN apt-get update && \
    apt-get install -y \
    git \
    python3-dev \
    build-essential

# Set the working directory for our application
WORKDIR /website

# Clone the specific branch from the repository
# The dot at the end means clone into current directory
RUN git clone --single-branch --branch main https://github.com/opencitations/oc_statistics .

# Install Python dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Expose the port that our service will listen on
EXPOSE 8080

# Start the application with Gunicorn
CMD ["gunicorn", "-c", "gunicorn.conf.py", "statistics_oc:application"]
```