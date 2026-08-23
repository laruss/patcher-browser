import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildNodeEsmEntry,
  copyDirectory,
} from "../../../scripts/build-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

async function assertPathExists(pathToCheck, label) {
  try {
    await access(pathToCheck);
  } catch {
    throw new Error(
      `Missing ${label} at ${pathToCheck}. Build @patcher/app, @patcher/server, and @patcher/host-daemon before packaging patcher-app.`,
    );
  }
}

async function copyBuildOutput({ from, label, to }) {
  await assertPathExists(from, label);
  await copyDirectory({ from, to });
}

async function buildPublicSdkDeclarations() {
  await execFileAsync(
    "node",
    [resolve(scriptsDir, "build-public-sdk-dts.mjs")],
    { cwd: packageRoot },
  );
}

const entrypoints = [
  ["patcher-app", "patcher-app.js"],
  ["patcher", "patcher.js"],
  ["patcher-server", "patcher-server.js"],
  ["patcher-host-daemon", "patcher-host-daemon.js"],
];

for (const [sourceName, outputName] of entrypoints) {
  await buildNodeEsmEntry({
    cleanDist: sourceName === "patcher-app",
    entryPoint: resolve(packageRoot, "src", "bin", `${sourceName}.ts`),
    executable: true,
    outfile: resolve(packageRoot, "dist", outputName),
    packageRoot,
  });
}

await buildNodeEsmEntry({
  cleanDist: false,
  entryPoint: resolve(packageRoot, "src", "public-sdk.ts"),
  outfile: resolve(packageRoot, "dist", "index.js"),
  packageRoot,
});
await buildPublicSdkDeclarations();

await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "app", "dist"),
  label: "@patcher/app dist",
  to: resolve(packageRoot, "app", "dist"),
});
await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "server", "dist"),
  label: "@patcher/server dist",
  to: resolve(packageRoot, "server", "dist"),
});
// Builtin plugins are bundled at packaging time (not in @patcher/server's build,
// which source checkouts don't need — the registry falls back to the repo's
// plugins/<name> there). Runs in apps/server so tsx + workspace imports
// resolve; writes straight into the packaged server dist.
await execFileAsync(
  "node",
  [
    "--conditions=source",
    "--import",
    "tsx",
    resolve(
      workspaceRoot,
      "apps",
      "server",
      "scripts",
      "copy-builtin-plugins.ts",
    ),
    "--target",
    resolve(packageRoot, "server", "dist", "builtin-plugins"),
  ],
  { cwd: resolve(workspaceRoot, "apps", "server") },
);
await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "host-daemon", "dist"),
  label: "@patcher/host-daemon dist",
  to: resolve(packageRoot, "host-daemon", "dist"),
});

process.stdout.write("patcher-app: built package assets\n");
