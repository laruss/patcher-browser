import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "patcher-site-access-"));
try {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    stdin: {
      resolveDir: packageRoot,
      sourcefile: "site-access-fixture.ts",
      contents: [
        'export { createDesktopBrowserViewManager, PATCHER_BROWSER_PARTITION } from "./src/desktop-browser-view.ts";',
        'export { createDesktopSiteAuthority, siteDigest } from "./src/desktop-site-authority.ts";',
        'export { registerDesktopBrowserIpc } from "./src/desktop-browser-main-ipc.ts";',
        'export { registerDesktopSiteIpc } from "./src/desktop-site-ipc.ts";',
        'export { executeScopedBrowserCommand } from "./src/desktop-scoped-browser-command.ts";',
        'export { createCdpSession } from "./src/desktop-browser-cdp.ts";',
        'export { runBrowserSiteOperation } from "./src/browser-site-operation.ts";',
      ].join("\n"),
    },
    outfile: join(root, "runtime.cjs"),
  });
  const env = {
    ...process.env,
    PATCHER_SITE_ACCESS_ROOT: root,
    PATCHER_SITE_ACCESS_DIST: process.argv.includes("--packaged")
      ? resolve(
          packageRoot,
          "release/mac-arm64/Patcher.app/Contents/Resources/app.asar/dist",
        )
      : resolve(packageRoot, "dist"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [resolve(packageRoot, "scripts/fixtures/plugin-site-access.cjs")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 55_000);
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve([code, signal]));
  });
  clearTimeout(timer);
  if (code !== 0) {
    console.error(
      timedOut
        ? "Site access smoke exceeded its 55-second deadline"
        : `Site access fixture exited: code=${code}, signal=${signal}`,
    );
    process.exitCode = 1;
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
