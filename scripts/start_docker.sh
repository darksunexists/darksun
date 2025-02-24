#!/bin/bash


echo "derpderp"

# Check if mode argument is provided
if [ $# -lt 1 ] || [ $# -gt 2 ]; then
    echo "Usage: ./start_docker.sh <mode> [use_nginx]"
    echo "Available modes: standalone, holmes, twitter, telegram"
    echo "use_nginx: Optional parameter (true/false), defaults to false"
    exit 1
fi

MODE=$1
USE_NGINX=${2:-false}  # Default to false if not provided

# Validate mode
if [ "$MODE" != "standalone" ] && [ "$MODE" != "holmes" ] && [ "$MODE" != "twitter" ] && [ "$MODE" != "telegram" ]; then
    echo "Invalid mode. Available modes: standalone, holmes, twitter, telegram"
    exit 1
fi

# Build the base image first
# docker build -t darksun-base:latest -f Dockerfile.base .
# docker build --no-cache -t darksun-base:latest -f Dockerfile.base .

docker build -t "darksun-$MODE:latest" -f "Dockerfile.$MODE" . --progress=plain
# docker build --no-cache -t "darksun-$MODE:latest" -f "Dockerfile.$MODE" .

# Build and run with or without nginx based on the parameter
if [ "$USE_NGINX" = "true" ]; then
    # Build nginx image
    docker build -t darksun-nginx:latest ./nginx
    # Run with nginx
    docker compose --profile "$MODE" --profile nginx up -d
else
    # Run without nginx
    docker compose --profile "$MODE" up -d
fi

