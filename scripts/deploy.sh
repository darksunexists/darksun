#!/bin/bash

# Exit on error
set -e

echo "Starting deployment..."

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: docker is not installed!"
    echo "Please run ./scripts/install-docker.sh first"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please create .env file from .env.example"
    exit 1
fi

# Build and start the container using docker compose
docker compose up -d --build

echo "Deployment completed! Container is running."
echo "View logs with: docker compose logs -f"