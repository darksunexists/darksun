import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['agents/src/index.ts'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  format: ['esm'],
  dts: true,
  platform: 'node',
  target: 'node18',
  bundle: true,
  splitting: true, // Add this for better code splitting
  external: [
    'dotenv', // Externalize dotenv to prevent bundling
    'fs', // Externalize fs to use Node.js built-in module
    'path', // Externalize other built-ins if necessary
    'http',
    'https',
    // Add other modules you want to externalize
    '@tavily/core',
    'onnxruntime-node',
    'sharp',
  ],
});
