import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"], // Entry point of the library
  format: ["esm", "cjs"], // Output both ESM and CJS formats
  dts: true, // Generate TypeScript declaration files
  sourcemap: true, // Generate sourcemaps for debugging
  clean: true, // Clean the dist folder before building
  external: ["react", "react-dom"], // Mark peer dependencies as external
});
