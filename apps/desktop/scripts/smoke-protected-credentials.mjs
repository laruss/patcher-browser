import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "patcher-credential-smoke-"));
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(root, "key.pem"),
      "-out",
      join(root, "cert.pem"),
      "-subj",
      "/CN=127.0.0.1",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    alias: {
      "@patcher/plugin-sdk": resolve(
        packageRoot,
        "../../packages/plugin-sdk/src/index.ts",
      ),
    },
    entryPoints: [
      process.env.PATCHER_PASSWORD_MANAGER_SMOKE_ENTRY ??
        resolve(packageRoot, "../../plugins/password-manager/server.ts"),
    ],
    outfile: join(root, "manager.mjs"),
  });
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    stdin: {
      resolveDir: packageRoot,
      contents: [
        'export { prepareCredentialForm } from "./src/desktop-credential-form.ts";',
        'export { createCredentialVault } from "./src/desktop-credential-vault.ts";',
        'export { createCredentialKeyStore } from "./src/desktop-credential-key.ts";',
        'export { createDesktopSiteAuthority } from "./src/desktop-site-authority.ts";',
        'export { createCdpSession } from "./src/desktop-browser-cdp.ts";',
        'export { redactCredentialNodes } from "./src/desktop-credential-redaction.ts";',
        'export { buildBrowserSnapshot } from "./src/desktop-browser-snapshot.ts";',
      ].join("\n"),
    },
    outfile: join(root, "runtime.cjs"),
  });
  await build({
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    entryPoints: [join(packageRoot, "src/credential-release-preload.ts")],
    outfile: join(root, "preload-module.cjs"),
  });
  await writeFile(
    join(root, "preload.cjs"),
    (await readFile(join(root, "preload-module.cjs"), "utf8")) +
      "\nmodule.exports.installCredentialRelease();\n",
  );
  const env = { ...process.env, PATCHER_CREDENTIAL_SMOKE_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [join(packageRoot, "scripts/fixtures/protected-credentials.cjs")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill("SIGKILL"), 55_000);
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve([code, signal]));
  });
  clearTimeout(timer);
  if (code !== 0) {
    console.error(`Credential smoke failed: code=${code}, signal=${signal}`);
    process.exitCode = 1;
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
