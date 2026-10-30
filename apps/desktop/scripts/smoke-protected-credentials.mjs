import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(packageRoot, "../app");
const root = await mkdtemp(join(tmpdir(), "patcher-password-manager-smoke-"));
try {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    stdin: {
      resolveDir: packageRoot,
      contents: [
        'export { createDesktopBrowserViewManager, PATCHER_BROWSER_PARTITION } from "./src/desktop-browser-view.ts";',
        'export { createPasswordManager } from "./src/password-manager.ts";',
        'export { registerPasswordManagerIpc } from "./src/password-manager-ipc.ts";',
        'export { registerPasswordManagerBrowser } from "./src/password-manager-browser.ts";',
        'export { createCredentialKeyStore } from "./src/desktop-credential-key.ts";',
        'export { authenticatePasswordManager } from "./src/password-manager-auth.ts";',
        'export { installApplicationMenu } from "./src/menu.ts";',
        'export { PASSWORD_MANAGER_CHANNELS } from "@patcher/desktop-contract";',
      ].join("\n"),
    },
    outfile: join(root, "runtime.cjs"),
  });
  await build({
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    stdin: {
      resolveDir: packageRoot,
      contents:
        'import { contextBridge } from "electron"; import { preloadPasswordManager } from "./src/preload-password-manager.ts"; contextBridge.exposeInMainWorld("patcherDesktop", {passwordManager: preloadPasswordManager});',
    },
    outfile: join(root, "manager-preload.cjs"),
  });
  await build({
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    conditions: ["source"],
    tsconfig: join(appRoot, "tsconfig.json"),
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.DEV": "false",
    },
    stdin: {
      resolveDir: appRoot,
      sourcefile: "password-manager-smoke-ui.tsx",
      loader: "tsx",
      contents: `
      import { createRoot } from "react-dom/client";
      import { BrowserRouter, Routes, Route } from "react-router-dom";
      import { PasswordManagerView } from "./src/views/PasswordManagerView.tsx";
      import { usePasswordManagerNavigation } from "./src/lib/password-manager-navigation.ts";
      function App() { usePasswordManagerNavigation(); return <Routes><Route path="/password-manager" element={<PasswordManagerView/>}/><Route path="*" element={<h1>Browser shell</h1>}/></Routes>; }
      createRoot(document.getElementById("root")).render(<BrowserRouter><App/></BrowserRouter>);
    `,
    },
    outfile: join(root, "ui.js"),
  });
  const assets = join(appRoot, "dist/assets");
  const css = (await readdir(assets)).find((file) =>
    /^index-.*\.css$/u.test(file),
  );
  if (!css)
    throw new Error(
      "Build @patcher/app before running the password-manager smoke",
    );
  await writeFile(join(root, "theme.css"), await readFile(join(assets, css)));
  const env = {
    ...process.env,
    PATCHER_CREDENTIAL_SMOKE_ROOT: root,
    PATCHER_CREDENTIAL_SMOKE_DIST: join(packageRoot, "dist"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [join(packageRoot, "scripts/fixtures/protected-credentials.cjs")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const timer = setTimeout(
    () => child.kill("SIGKILL"),
    process.env.PATCHER_PASSWORD_QA_REAL_AUTH ? 190_000 : 55_000,
  );
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve([code, signal]));
  });
  clearTimeout(timer);
  if (code !== 0) {
    console.error(
      `Password Manager smoke failed: code=${code}, signal=${signal}`,
    );
    process.exitCode = 1;
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
