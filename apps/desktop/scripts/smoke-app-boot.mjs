#!/usr/bin/env node
// Boots the SPA in the Chromium the product ships — from the dev server and
// from the built bundle — and fails on any error the start-up raises.
//
// The gap this fills, written down because every other check looked green while
// the app was dead: `turbo run build` finishes at exit 0 even when Vite
// externalizes a Node builtin, the boot-payload budget measures bytes, the
// packaged smoke drives the Electron shell against a stub page rather than the
// app, and every vitest suite runs in Node with jsdom — which has no ES module
// loader for a built bundle and resolves `node:crypto` for real. So "the app
// does not start" was not a state any gate could be in, and it took a person
// opening the window to find out.
//
// What counts as a failure here is deliberately narrow, so this cannot become
// the flaky job everyone reruns:
//
//   - an uncaught exception or unhandled rejection in the page, collected from
//     a preload that installs its listeners before any app code runs;
//   - the document failing to load, or the renderer process dying;
//   - `#root` still empty when the deadline passes — a white screen by any
//     other route.
//
// Everything the network says is ignored on purpose. The stub server answers
// `/api` with 503, so a boot that reports "cannot reach the server" in the UI
// is a pass: it started, which is the question being asked.
//
// Both modes, because they fail differently and the incident that prompted this
// only showed up in one. Vite's dev transform turns an import of an
// externalized module into a destructure at the top of the module, so touching
// `node:crypto` kills the module the moment it evaluates; the production build
// tree-shakes the same import away when nothing calls it, and boots. A gate
// that only watched `dist` would have called the white screen a pass.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(scriptDirectory, "..");
const appDir = resolve(desktopPackageRoot, "..", "app");
const appDistDir = join(appDir, "dist");
const devServerStartTimeoutMs = 60_000;
// The dev server compiles on demand, so its first paint waits for a dependency
// optimization the built bundle has already had.
const bootTimeoutMs = { dev: 120_000, dist: 60_000 };
// Nothing here may outlive this. A hang with no output is the one failure mode
// that costs a whole CI job and says nothing, which is exactly how the first
// run of this smoke ended.
const watchdogTimeoutMs = 8 * 60_000;
const maxCapturedOutputCharacters = 20_000;

/** Progress, so a hang names the stage it hung in. */
function log(message) {
  console.log(`app boot smoke: ${message}`);
}

const CONTENT_TYPES = new Map(
  Object.entries({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }),
);

/**
 * Serves `apps/app/dist` and answers everything else the way a server that is
 * not up yet does. The app must survive that: a client which only starts when
 * its API answers is a client that shows a white screen whenever the server is
 * slow.
 */
async function startDistServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "smoke server has no API" }));
      return;
    }

    const relativePath =
      url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filePath = normalize(join(appDistDir, relativePath));
    // The dist directory is the whole of what this server may read.
    if (!filePath.startsWith(appDistDir + sep) && filePath !== appDistDir) {
      response.writeHead(403).end();
      return;
    }

    readFile(filePath)
      .then((body) => {
        response.writeHead(200, {
          "content-type":
            CONTENT_TYPES.get(extname(filePath)) ?? "application/octet-stream",
        });
        response.end(body);
      })
      .catch(() => {
        // A single-page app's own routes are not files. Anything else missing
        // shows up as a console error the collector ignores and as an empty
        // `#root`, which it does not.
        readFile(join(appDistDir, "index.html"))
          .then((body) => {
            response.writeHead(200, {
              "content-type": "text/html; charset=utf-8",
            });
            response.end(body);
          })
          .catch(() => {
            response.writeHead(404).end();
          });
      });
  });

  await new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the boot smoke server to listen on a TCP port");
  }
  return {
    close: () =>
      new Promise((resolvePromise) => {
        server.close(() => {
          resolvePromise();
        });
      }),
    port: address.port,
  };
}

/** Colour codes, which a terminal hides and a regex does not. */
function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

/** A port nothing is on right now, so this never fights a running checkout. */
async function findFreePort() {
  const probe = createServer();
  await new Promise((resolvePromise) => {
    probe.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = probe.address();
  const port =
    address !== null && typeof address !== "string" ? address.port : 0;
  await new Promise((resolvePromise) => {
    probe.close(() => {
      resolvePromise();
    });
  });
  return port;
}

/**
 * The app's own dev server, on a port of its own so a checkout that is already
 * running one is untouched. The base config rather than `vite.dev.config.ts`:
 * the proxies and dev ports in that one belong to a running instance, and what
 * is being tested is whether the app's modules evaluate.
 */
async function startDevServer() {
  const appRequire = createRequire(join(appDir, "package.json"));
  // Through the manifest, not the subpath: vite's `exports` map does not list
  // its own bin, so `resolve("vite/bin/vite.js")` is refused.
  const vitePackageJsonPath = appRequire.resolve("vite/package.json");
  const vitePackageJson = JSON.parse(
    await readFile(vitePackageJsonPath, "utf8"),
  );
  const viteBin = resolve(
    dirname(vitePackageJsonPath),
    vitePackageJson.bin.vite,
  );
  const child = spawn(
    process.execPath,
    [
      viteBin,
      "--config",
      "vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(await findFreePort()),
      "--clearScreen",
      "false",
    ],
    {
      cwd: appDir,
      env: {
        ...process.env,
        NODE_ENV: "development",
        // CI is a colour-forcing environment, and a coloured URL is a URL with
        // escape codes inside the port. Ask for none, and strip what arrives
        // anyway (see `stripAnsi`) — the first run of this failed on exactly
        // that, reading `127.0.0.1:\x1b[1m49436` as no URL at all.
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
    },
  );

  const output = [];
  const kill = () => {
    child.kill("SIGKILL");
  };
  const url = await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      rejectPromise(
        new Error(
          `The app dev server never printed a URL.\n${stripAnsi(
            output.join(""),
          ).trim()}`,
        ),
      );
    }, devServerStartTimeoutMs);
    const onChunk = (chunk) => {
      appendOutput(output, chunk);
      const match = /(http:\/\/127\.0\.0\.1:\d+\/?)/.exec(
        stripAnsi(output.join("")),
      );
      if (match !== null) {
        clearTimeout(timeout);
        resolvePromise(match[1]);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      rejectPromise(
        new Error(
          `The app dev server exited with code ${String(code)}.\n${output
            .join("")
            .trim()}`,
        ),
      );
    });
  }).catch((error) => {
    // Otherwise a dev server that never answered keeps this process alive with
    // its pipes, and the job hangs until the runner kills it.
    kill();
    throw error;
  });

  return {
    close: async () => {
      child.kill("SIGTERM");
      await new Promise((resolvePromise) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolvePromise();
        }, 5_000);
        child.on("exit", () => {
          clearTimeout(timeout);
          resolvePromise();
        });
      });
    },
    url,
  };
}

/**
 * Runs before any of the app's own code, which is the only place from which an
 * error thrown while a module evaluates can still be seen. `contextIsolation`
 * is off for this one window on purpose: the page here is our own build, and
 * sharing its world is what lets the collector see the page's errors rather
 * than the preload's.
 */
const PRELOAD_SOURCE = `
window.__patcherBootErrors = [];
const record = (kind, message, stack) => {
  window.__patcherBootErrors.push({ kind, message: String(message ?? ""), stack: String(stack ?? "") });
};
window.addEventListener("error", (event) => {
  record("uncaught-error", event.message ?? event.error, event.error && event.error.stack);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  record("unhandled-rejection", reason && reason.message ? reason.message : reason, reason && reason.stack);
});
`;

const MAIN_SOURCE = `
const { app, BrowserWindow } = require("electron");

const appUrl = process.env.PATCHER_BOOT_SMOKE_URL;
const preloadPath = process.env.PATCHER_BOOT_SMOKE_PRELOAD;
const deadlineMs = Number(process.env.PATCHER_BOOT_SMOKE_TIMEOUT_MS);
const failures = [];

function report(code) {
  process.stdout.write("__PATCHER_BOOT_SMOKE__" + JSON.stringify({ failures }) + "\\n");
  app.exit(code);
}

app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      failures.push({ kind: "did-fail-load", message: errorDescription + " (" + errorCode + ") for " + validatedURL });
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    failures.push({ kind: "render-process-gone", message: details.reason });
  });
  window.webContents.on("preload-error", (_event, preloadFile, error) => {
    failures.push({ kind: "preload-error", message: preloadFile + ": " + error.message });
  });

  try {
    await window.loadURL(appUrl);
  } catch (error) {
    failures.push({ kind: "load-failed", message: String(error && error.message ? error.message : error) });
    report(1);
    return;
  }

  // Poll rather than wait for one event: "rendered something" is the only
  // signal that means the app got as far as its first paint, and no lifecycle
  // event reports it from outside the page.
  const startedAt = Date.now();
  let rendered = false;
  while (Date.now() - startedAt < deadlineMs) {
    try {
      rendered = await window.webContents.executeJavaScript(
        "Boolean(document.getElementById('root') && document.getElementById('root').childElementCount > 0)",
      );
    } catch (error) {
      failures.push({ kind: "probe-failed", message: String(error && error.message ? error.message : error) });
      break;
    }
    if (rendered || failures.length > 0) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  try {
    const pageErrors = await window.webContents.executeJavaScript("window.__patcherBootErrors || []");
    failures.push(...pageErrors);
  } catch (error) {
    failures.push({ kind: "collector-unreachable", message: String(error && error.message ? error.message : error) });
  }

  if (!rendered) {
    failures.push({ kind: "empty-root", message: "#root had no children after " + deadlineMs + "ms — a white screen" });
  }

  report(failures.length === 0 ? 0 : 1);
});
`;

function appendOutput(chunks, chunk) {
  chunks.push(String(chunk));
  let totalLength = chunks.reduce((total, value) => total + value.length, 0);
  while (totalLength > maxCapturedOutputCharacters && chunks.length > 1) {
    const removed = chunks.shift();
    totalLength -= removed.length;
  }
}

function parseVerdict(output) {
  const marker = "__PATCHER_BOOT_SMOKE__";
  const line = output
    .split("\n")
    .reverse()
    .find((candidate) => candidate.includes(marker));
  if (line === undefined) return null;
  try {
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  } catch {
    return null;
  }
}

/** One boot: point Electron at `url`, and report what the start-up raised. */
async function bootOnce({ url, preloadPath, mainPath, deadlineMs }) {
  const stdout = [];
  const stderr = [];
  const electronBinary = require("electron");
  log(`booting ${url} in ${electronBinary}`);
  const child = spawn(electronBinary, [mainPath], {
    env: {
      ...process.env,
      PATCHER_BOOT_SMOKE_URL: url,
      PATCHER_BOOT_SMOKE_PRELOAD: preloadPath,
      PATCHER_BOOT_SMOKE_TIMEOUT_MS: String(deadlineMs),
      // A CI runner has no user namespaces to build a sandbox out of, and this
      // window shows one page: our own build.
      ELECTRON_DISABLE_SANDBOX: "1",
    },
  });
  child.stdout.on("data", (chunk) => {
    appendOutput(stdout, chunk);
  });
  // Electron's own complaints — a window server it cannot reach, a GPU process
  // that will not start — go straight to the log rather than into a buffer
  // nobody prints when the run is killed.
  child.stderr.on("data", (chunk) => {
    appendOutput(stderr, chunk);
    process.stderr.write(chunk);
  });

  const exitCode = await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise("timeout");
    }, deadlineMs + 30_000);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolvePromise(code ?? 1);
    });
  });

  const output = stdout.join("");
  const verdict = parseVerdict(output);
  if (exitCode === "timeout" || verdict === null) {
    throw new Error(
      [
        "The app boot smoke never reported a verdict.",
        `exit: ${String(exitCode)}`,
        `stdout:\n${output.trim()}`,
        `stderr:\n${stderr.join("").trim()}`,
      ].join("\n"),
    );
  }
  return verdict.failures;
}

function formatFailures(mode, failures) {
  const detail = failures
    .map(
      (failure) =>
        `  - [${failure.kind}] ${failure.message}${
          failure.stack ? `\n${failure.stack}` : ""
        }`,
    )
    .join("\n");
  return `${mode}: ${failures.length} error(s) while starting:\n${detail}`;
}

async function main() {
  if (!existsSync(join(appDistDir, "index.html"))) {
    throw new Error(
      `No built app at ${appDistDir}. Run \`bun run --filter=@patcher/app build\` first.`,
    );
  }

  const smokeRoot = await mkdtemp(join(tmpdir(), "patcher-app-boot-smoke-"));
  const preloadPath = join(smokeRoot, "preload.cjs");
  const mainPath = join(smokeRoot, "main.cjs");
  await writeFile(preloadPath, PRELOAD_SOURCE, "utf8");
  await writeFile(mainPath, MAIN_SOURCE, "utf8");

  const problems = [];
  const watchdog = setTimeout(() => {
    console.error(
      `app boot smoke: nothing finished within ${watchdogTimeoutMs}ms — killing the run so the log says where it stopped`,
    );
    process.exit(1);
  }, watchdogTimeoutMs);

  try {
    log("starting the app dev server");
    const devServer = await startDevServer();
    log(`dev server at ${devServer.url}`);
    try {
      const failures = await bootOnce({
        url: devServer.url,
        preloadPath,
        mainPath,
        deadlineMs: bootTimeoutMs.dev,
      });
      if (failures.length > 0) {
        problems.push(formatFailures("dev server", failures));
      } else {
        log("the dev server started with no errors");
      }
    } finally {
      await devServer.close();
    }

    log("serving the built bundle");
    const distServer = await startDistServer();
    try {
      const failures = await bootOnce({
        url: `http://127.0.0.1:${distServer.port}/`,
        preloadPath,
        mainPath,
        deadlineMs: bootTimeoutMs.dist,
      });
      if (failures.length > 0) {
        problems.push(formatFailures("built bundle", failures));
      } else {
        log("the built bundle started with no errors");
      }
    } finally {
      await distServer.close();
    }
  } finally {
    clearTimeout(watchdog);
    await rm(smokeRoot, { force: true, recursive: true });
  }

  if (problems.length > 0) {
    throw new Error(problems.join("\n\n"));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
