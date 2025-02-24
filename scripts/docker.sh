#!/bin/bash

# Check if both arguments are provided
if [ $# -lt 2 ]; then
    echo "Usage: $0 {build|run|start|bash} {twitter|telegram} {3001|3002|3003}"
    exit 1
fi

# Validate client type
CLIENT_TYPE=$2
if [ "$CLIENT_TYPE" != "twitter" ] && [ "$CLIENT_TYPE" != "telegram" ]; then
    echo "Error: client_type must be either 'twitter' or 'telegram'"
    echo "Usage: $0 {build|run|start|bash} {twitter|telegram}"
    exit 1
fi

# Validate port
PORT=$3
if [ "$PORT" != "3001" ] && [ "$PORT" != "3002" ] && [ "$PORT" != "3003" ]; then
    PORT=3000
    echo "Warning: port not specified, defaulting to 3000"
fi

# Execute the corresponding command based on the argument
case "$1" in
    build)
        docker build --platform linux/amd64 --build-arg CLIENT_TYPE=$CLIENT_TYPE -t darksun .
        ;;
    run)
        # Ensure the container is not already running
        if [ "$(docker ps -q -f name=darksun-${CLIENT_TYPE})" ]; then
            echo "Container 'darksun-${CLIENT_TYPE}' is already running. Stopping it first."
            docker stop darksun-${CLIENT_TYPE}
            docker rm darksun-${CLIENT_TYPE}
        fi

        # Define base directories to mount
        BASE_MOUNTS=(
            "agents:/app/agents"
            "eliza:/app/eliza"
            "scripts:/app/scripts"
            ".env:/app/.env"
        ) 

        # Start building the docker run command
        CMD="docker run --platform linux/amd64 -p ${PORT}:${PORT} -d"

        # Add base mounts
        for mount in "${BASE_MOUNTS[@]}"; do
            CMD="$CMD -v \"$(pwd)/$mount\""
        done

        # Add core types mount separately (special case)
        CMD="$CMD -v \"$(pwd)/packages/core/types:/app/packages/core/types\""

        # Add container name and image with client type environment variable
        CMD="$CMD -e CLIENT_TYPE=$CLIENT_TYPE --name darksun-${CLIENT_TYPE} darksun"

        # Execute the command
        eval $CMD
        ;;
    start)
        docker start darksun-${CLIENT_TYPE}
        ;;
    bash)
        # Check if the container is running before executing bash
        if [ "$(docker ps -q -f name=darksun-${CLIENT_TYPE})" ]; then
            docker exec -it darksun-${CLIENT_TYPE} bash
        else
            echo "Container 'darksun-${CLIENT_TYPE}' is not running. Please start it first."
            exit 1
        fi
        ;;
    *)
        echo "Invalid option: $1"
        echo "Usage: $0 {build|run|start|bash} {twitter|telegram}"
        exit 1
        ;;
esac