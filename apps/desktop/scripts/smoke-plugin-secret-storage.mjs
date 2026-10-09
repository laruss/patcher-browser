import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../..");
const root = await mkdtemp(join(tmpdir(), "patcher-native-secret-smoke-"));
try {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    outdir: root,
    entryPoints: {
      broker: join(desktop, "src/desktop-secret-broker.ts"),
      process: join(desktop, "src/patcher-process.ts"),
      relay: join(repo, "packages/patcher-app/src/desktop-secret-relay.ts"),
      spawn: join(repo, "packages/patcher-app/src/launcher-managed-process.ts"),
      storage: join(
        repo,
        "apps/server/src/services/plugins/desktop-secret-storage.ts",
      ),
    },
  });
  for (const phase of ["encrypt", "restart"]) {
    const env = {
      ...process.env,
      PATCHER_SECRET_SMOKE_ROOT: root,
      PATCHER_SECRET_SMOKE_PHASE: phase,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      require("electron"),
      [join(desktop, "scripts/fixtures/plugin-secret-main.cjs")],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    clearTimeout(timer);
    if (code !== 0) throw new Error(`Native secret storage ${phase} failed`);
  }
  async function contents(path) {
    return (
      await Promise.all(
        (await readdir(path, { withFileTypes: true })).map((file) =>
          file.isDirectory()
            ? contents(join(path, file.name))
            : readFile(join(path, file.name), "utf8"),
        ),
      )
    ).join("");
  }
  if ((await contents(join(root, "data"))).includes("native-sentinel-秘密\n"))
    throw new Error("Plaintext sentinel remained in data directory");
  console.log(
    "Native safeStorage encrypt → restart main+launcher+server → decrypt, lock/unlock and private FD relay: passed",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
