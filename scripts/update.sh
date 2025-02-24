#!/bin/bash

# Exit on error
set -e

echo "Starting update process..."

# Check if git repository exists
if [ ! -d .git ]; then
    echo "Error: Not a git repository!"
    exit 1
fi

# Pull latest changes
git pull

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker daemon is not running!"
    exit 1
fi

# Rebuild and restart containers
docker compose down
docker compose up -d --build

echo "Update completed!"
echo "View logs with: docker compose logs -f"