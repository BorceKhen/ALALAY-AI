#!/bin/bash
set -e

PORT=${PORT:-8000}
exec gunicorn --bind 0.0.0.0:$PORT --pythonpath . --workers 1 --threads 4 --timeout 120 app:app

