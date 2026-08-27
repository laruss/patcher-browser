import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { bundleStats } from "./vite-bundle-stats.js";
import { noNodeBuiltins } from "./vite-no-node-builtins.js";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";

const appDir = dirname(fileURLToPath(import.meta.url));

// Annotated rather than inferred: the inferred plugin array names types from
// whichever `rolldown` copy a transitive vite pulls in, which is not portable
// across installs (TS2883).
export const sharedViteConfig: UserConfig = {
  plugins: [
    // First, so it sees a specifier before anything can rewrite it.
    noNodeBuiltins(),
    sharedUiEnvSeam(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    // Build-only: writes bundle-stats.json for the boot-payload budget check.
    bundleStats(),
  ],
  // Keep app and Ladle dep optimization metadata from clobbering each other.
  cacheDir: "node_modules/.vite/app",
  build: {
    // Skip compressed-size calculation to keep production app builds fast.
    reportCompressedSize: false,
  },
  optimizeDeps: {
    // The terminal imports xterm lazily when the panel mounts. Pre-optimize
    // these packages so opening the terminal does not discover new deps and
    // invalidate Vite's optimized-dependency hash mid-session.
    include: ["@xterm/addon-fit", "@xterm/addon-web-links", "@xterm/xterm"],
  },
  resolve: {
    conditions: ["source"],
    alias: {
      "@": resolve(appDir, "./src"),
    },
  },
} satisfies UserConfig;

export default defineConfig(sharedViteConfig);
