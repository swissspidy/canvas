import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Installs the Node disk font loader once for every test file. The layout
    // engine itself only knows the platform-neutral registry, so that it can
    // bundle for a browser unchanged.
    setupFiles: ["src/text/fonts.ts", "src/render/raster.ts"],
  },
});
