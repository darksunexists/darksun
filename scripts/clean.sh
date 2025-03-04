#!/bin/bash

# Navigate to the script's directory
cd "$(dirname "$0")"/..
echo "Cleanup started."
# Find and remove node_modules directories, dist directories, and pnpm-lock.yaml files
find . -type d -name "node_modules" -exec rm -rf {} + \
    -o -type d -name "dist" -exec rm -rf {} + \
    -o -type f -name "pnpm-lock.yaml" -exec rm -f {} +

echo "Cleanup completed."


# Clean additional cache and build files
echo "Cleaning additional cache and build files..."
rm -rf .turbo
rm -rf .cache
rm -rf .next
rm -rf coverage
rm -rf build

echo "Clean complete!"
