import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "patcher-secure-keyboard-"));
const preloadDir = process.argv.includes("--packaged")
  ? resolve(
      packageRoot,
      "release",
      "mac-arm64",
      "Patcher.app",
      "Contents",
      "Resources",
      "app.asar",
      "dist",
    )
  : resolve(packageRoot, "dist");
try {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    entryPoints: {
      security: resolve(packageRoot, "src", "secure-keyboard-entry.ts"),
      browser: resolve(packageRoot, "src", "desktop-browser-view.ts"),
    },
    outdir: root,
  });
  const env = {
    ...process.env,
    PATCHER_SECURE_KEYBOARD_ROOT: root,
    PATCHER_SECURE_KEYBOARD_DIST: preloadDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [resolve(packageRoot, "scripts", "fixtures", "secure-keyboard.cjs")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const deadline = setTimeout(() => child.kill("SIGKILL"), 50_000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  clearTimeout(deadline);
  if (code !== 0) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
