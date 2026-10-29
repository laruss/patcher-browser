import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "patcher-webauthn-smoke-"));
const binary = require("electron");
const entry = resolve(
  packageRoot,
  "scripts",
  "fixtures",
  "browser-webauthn.cjs",
);
try {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    entryPoints: [resolve(packageRoot, "src/native-webauthn.ts")],
    outfile: join(root, "native.cjs"),
  });
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, [entry], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...childEnv,
      PATCHER_WEBAUTHN_SMOKE_ROOT: root,
      PATCHER_WEBAUTHN_SMOKE_EXTENSION: resolve(
        packageRoot,
        "dist",
        "browser-security-extension",
      ),
      PATCHER_WEBAUTHN_SMOKE_NATIVE: process.argv.includes("--native")
        ? "1"
        : "0",
    },
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const deadline = setTimeout(() => child.kill("SIGKILL"), 40_000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  clearTimeout(deadline);
  if (code !== 0) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
