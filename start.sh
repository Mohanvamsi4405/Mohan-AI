#!/bin/bash

# Start the application with Gunicorn
# Gunicorn is a production-ready server that manages Uvicorn workers
# -w 4: starts 4 worker processes
# -k uvicorn.workers.UvicornWorker: uses Uvicorn workers
# app:app: tells Gunicorn to look for the 'app' variable in the 'app.py' module
gunicorn -w 4 -k uvicorn.workers.UvicornWorker app:app