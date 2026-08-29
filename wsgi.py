import os
import sys

# Ensure root directory is in sys.path for Gunicorn on Azure App Service
root_dir = os.path.dirname(os.path.abspath(__file__))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app import app

if __name__ == "__main__":
    app.run()
