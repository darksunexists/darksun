#!/bin/bash

echo "Building darksun..."
pnpm build

# Build the postgres adapter
cd packages/adapter-postgres
echo "Building postgres adapter..."
pnpm build

# Build the perplexity plugin
cd packages/plugin-perplexity
echo "Building perplexity plugin..."
pnpm build

echo "Build complete!"
