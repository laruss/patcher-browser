import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { resolveDesktopReleaseChannel } from "./desktop-release-channel.mjs";

const packageRoot = process.cwd();
const distDir = resolve(packageRoot, "dist");
const packageJsonPath = resolve(packageRoot, "package.json");

function readPackageVersion(packageJsonText) {
  const packageJson = JSON.parse(packageJsonText);
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("apps/desktop/package.json must define a version");
  }
  return packageJson.version;
}

await rm(distDir, { force: true, recursive: true });

const desktopVersion = readPackageVersion(
  await readFile(packageJsonPath, "utf8"),
);
const desktopReleaseChannel = resolveDesktopReleaseChannel(process.env);

const commonOptions = {
  bundle: true,
  define: {
    "process.env.PATCHER_DESKTOP_RELEASE_CHANNEL": JSON.stringify(
      desktopReleaseChannel,
    ),
    "process.env.PATCHER_DESKTOP_VERSION": JSON.stringify(desktopVersion),
  },
  legalComments: "none",
  platform: "node",
  sourcemap: true,
  target: "node24",
};

await Promise.all([
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "main.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "main.js"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "preload.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "preload.cjs"),
  }),
  build({
    ...commonOptions,
    // The preload for browsed pages. Bundled like the others, and with one thing
    // to keep true: it imports only `electron` and type-only names, so nothing
    // from @patcher/desktop-contract (zod included) ends up in a website's renderer.
    entryPoints: [resolve(packageRoot, "src", "page-script-preload.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "page-script-preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "log-viewer-preload.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "log-viewer-preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "server-url-dialog-preload.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "server-url-dialog-preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [
      resolve(packageRoot, "src", "existing-server-dialog-preload.ts"),
    ],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "existing-server-dialog-preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "pdf-text-process.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "pdf-text-process.js"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "patcher-app-bridge.ts")],
    external: ["patcher-app", "patcher-app/*"],
    format: "esm",
    outfile: resolve(distDir, "patcher-app-bridge.mjs"),
  }),
]);

process.stdout.write("@patcher/desktop: built Electron entries\n");
