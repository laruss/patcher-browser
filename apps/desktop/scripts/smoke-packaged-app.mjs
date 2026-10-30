import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { access, readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDesktopReleaseConfig,
  resolveDesktopReleaseChannel,
} from "./desktop-release-channel.mjs";
import { smokeOwnedPasswordManager } from "./smoke-owned-password-manager.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(scriptDirectory, "..");
const releaseDir =
  process.env.PATCHER_PACKAGED_SMOKE_RELEASE_DIR ??
  join(desktopPackageRoot, "release");
const releaseConfig = createDesktopReleaseConfig(
  resolveDesktopReleaseChannel(process.env),
);
const appBundleName = `${releaseConfig.applicationName}.app`;
const appBinaryRelativePath = join(
  appBundleName,
  "Contents",
  "MacOS",
  releaseConfig.applicationName,
);
const startupTimeoutMs = 20_000;
const exitTimeoutMs = 5_000;
const postReadySettleMs = 300;
const maxCapturedOutputCharacters = 20_000;

function writeJson(response, body) {
  response.writeHead(200, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function writeHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
  });
  response.end(html);
}

function writeNotFound(response) {
  response.writeHead(404, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify({ message: "not found" }));
}

function createDesktopVersionFeed(version) {
  return {
    schemaVersion: 1,
    channel: "latest",
    platform: "macos",
    version,
    releaseDate: new Date(0).toISOString(),
    releaseName: `Patcher desktop ${version}`,
    releaseNotes: null,
    minimumSystemVersion: null,
    files: [
      {
        url: "https://example.invalid/Patcher.zip",
        sha512: "smoke",
        size: 0,
      },
    ],
    path: "Patcher.zip",
    sha512: "smoke",
    stagingPercentage: null,
  };
}

function renderSmokePage(expectedDesktopVersion) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Patcher packaged desktop smoke</title>
<main>packaged desktop smoke</main>
<script>
(async () => {
  let ok = false;
  let reason = "";
  try {
    if (typeof window.patcherDesktop !== "object" || window.patcherDesktop === null) {
      reason = "missing window.patcherDesktop";
    } else if (typeof window.patcherDesktop.getInfo !== "function") {
      reason = "missing window.patcherDesktop.getInfo";
    } else {
      const info = await window.patcherDesktop.getInfo();
      const expectedVersion = ${JSON.stringify(expectedDesktopVersion)};
      ok =
        window.patcherDesktop.platform === "macos" &&
        window.patcherDesktop.version === expectedVersion &&
        info.version === expectedVersion;
      reason = ok ? "" : "unexpected desktop bridge info";
      if (ok) {
        window.patcherDesktop.browser.attach({
          tabId: "packaged-webauthn-smoke",
          url: new URL("/smoke/browser", location.href).href,
          bounds: { x: 0, y: 0, width: 400, height: 300 },
          visible: false,
        });
        const deadline = Date.now() + 5000;
        let result = null;
        while (result === null && Date.now() < deadline) {
          result = await fetch("/smoke/browser-result").then(response => response.json());
          if (result === null) await new Promise(resolve => setTimeout(resolve, 25));
        }
        ok = result?.ok === true;
        reason = result?.reason ?? "browser compatibility script did not answer";
      }
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  const params = new URLSearchParams({
    ok: ok ? "1" : "0",
    reason,
  });
  await fetch("/smoke/preload-ready?" + params.toString(), { method: "POST" });
})();
</script>`;
}

async function readDesktopPackageVersion() {
  const packageJsonText = await readFile(
    join(desktopPackageRoot, "package.json"),
    "utf8",
  );
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

async function resolvePackagedAppBinary() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const macOutputDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
    .map((entry) => entry.name)
    .sort();

  for (const directory of macOutputDirectories) {
    const appBinary = join(releaseDir, directory, appBinaryRelativePath);
    try {
      await access(appBinary);
      return appBinary;
    } catch {
      continue;
    }
  }

  throw new Error(`No packaged ${appBundleName} found under ${releaseDir}`);
}

async function startCertificateServer(root) {
  const key = join(root, "key.pem");
  const cert = join(root, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=certificate-smoke.test",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  let rejected = 0;
  let accepted = 0;
  const server = createHttpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (_request, response) => {
      accepted += 1;
      response.end("This certificate must not be trusted.");
    },
  );
  server.on("tlsClientError", () => {
    rejected += 1;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `https://certificate-smoke.test:${server.address().port}`,
    assertRejected() {
      if (rejected === 0 || accepted !== 0) {
        throw new Error(
          `Expected rejected TLS handshakes; rejected=${rejected}, accepted=${accepted}`,
        );
      }
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startSmokeServer({
  dataDir,
  expectedDesktopVersion,
  certificateUrl,
}) {
  let browserResult = null;
  let resolvePreloadReady = () => {};
  const preloadReady = new Promise((resolvePromise) => {
    resolvePreloadReady = resolvePromise;
  });
  const server = createServer((request, response) => {
    if (request.url === "/smoke/browser") {
      writeHtml(
        response,
        `<!doctype html><script>
        (async () => {
          let ok = false;
          let reason = "";
          try {
            // Concurrent certificate errors used to crash Electron 45 while
            // converting the second certificate-error event's borrowed URL.
            await Promise.all(Array.from({ length: 16 }, (_, index) => new Promise((resolve, reject) => {
              const image = new Image();
              image.onerror = resolve;
              image.onload = () => reject(new Error("Untrusted certificate accepted"));
              image.src = ${JSON.stringify(certificateUrl)} + "/untrusted-" + index + ".png";
            })));
            const available = await PublicKeyCredential.isConditionalMediationAvailable();
            const capabilities = await PublicKeyCredential.getClientCapabilities();
            const exposed = typeof require !== "undefined" || typeof process !== "undefined" || typeof patcherDesktop !== "undefined";
            ok = available === false && capabilities.hybridTransport === false && !exposed;
            reason = ok ? "" : "missing compatibility policy or exposed app bridge";
          } catch (error) { reason = String(error); }
          await fetch("/smoke/browser-ready?" + new URLSearchParams({ ok: ok ? "1" : "0", reason }), { method: "POST" });
        })();
      </script>`,
      );
      return;
    }
    if (request.url?.startsWith("/smoke/browser-ready?") === true) {
      const url = new URL(request.url, "http://127.0.0.1");
      browserResult = {
        ok: url.searchParams.get("ok") === "1",
        reason: url.searchParams.get("reason") ?? "",
      };
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/smoke/browser-result") {
      writeJson(response, browserResult);
      return;
    }
    if (request.url === "/health") {
      writeJson(response, { ok: true });
      return;
    }

    if (request.url === "/api/v1/system/config") {
      writeJson(response, {
        appearance: {
          customCss: null,
          faviconColor: "default",
          themeId: "default",
        },
        customThemes: [],
        dataDir,
        experiments: {
          claudeCodeMockCliTraffic: false,
          newOnboarding: false,
          toolsHub: false,
        },
        featureFlags: {
          placeholder: false,
        },
        generalSettings: {
          caffeinate: false,
        },
        hostDaemonPort: 38987,
        primaryHostPlatform: null,
        outsideAgentSetup: "unasked",
        voiceTranscriptionEnabled: false,
      });
      return;
    }

    if (request.url === "/desktop-version.json") {
      writeJson(response, createDesktopVersionFeed(expectedDesktopVersion));
      return;
    }

    if (request.url === "/" || request.url === "/index.html") {
      writeHtml(response, renderSmokePage(expectedDesktopVersion));
      return;
    }

    if (request.url?.startsWith("/smoke/preload-ready") === true) {
      const url = new URL(request.url, "http://127.0.0.1");
      resolvePreloadReady({
        ok: url.searchParams.get("ok") === "1",
        reason: url.searchParams.get("reason") ?? "",
      });
      response.writeHead(204);
      response.end();
      return;
    }

    writeNotFound(response);
  });

  await new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected desktop smoke server to listen on a TCP port");
  }

  return {
    close: async () => {
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });
    },
    port: address.port,
    preloadReady,
  };
}

function appendOutput(chunks, chunk) {
  chunks.push(String(chunk));
  let totalLength = chunks.reduce((total, value) => total + value.length, 0);
  while (totalLength > maxCapturedOutputCharacters && chunks.length > 1) {
    const removed = chunks.shift();
    totalLength -= removed.length;
  }
}

function formatProcessOutput({ stdout, stderr }) {
  const stdoutText = stdout.join("").trim();
  const stderrText = stderr.join("").trim();
  return [
    stdoutText.length > 0 ? `stdout:\n${stdoutText}` : "",
    stderrText.length > 0 ? `stderr:\n${stderrText}` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

async function waitForPreloadReady({ child, preloadReady, stdout, stderr }) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(
        new Error(
          `Timed out waiting for the packaged Electron app to report ready.\n${formatProcessOutput(
            { stdout, stderr },
          )}`,
        ),
      );
    }, startupTimeoutMs);

    const handleExit = (code, signal) => {
      cleanup();
      rejectPromise(
        new Error(
          `Packaged Electron app exited before startup completed: code=${String(
            code,
          )} signal=${String(signal)}.\n${formatProcessOutput({
            stdout,
            stderr,
          })}`,
        ),
      );
    };
    const handleError = (error) => {
      cleanup();
      rejectPromise(
        new Error(
          `Could not launch packaged Electron app: ${
            error instanceof Error ? error.message : String(error)
          }.\n${formatProcessOutput({ stdout, stderr })}`,
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", handleExit);
      child.off("error", handleError);
    };

    child.once("exit", handleExit);
    child.once("error", handleError);
    preloadReady.then(
      (result) => {
        cleanup();
        resolvePromise(result);
      },
      (error) => {
        cleanup();
        rejectPromise(error);
      },
    );
  });
}

async function sleep(delayMs) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolvePromise(false);
    }, timeoutMs);

    const handleExit = () => {
      cleanup();
      resolvePromise(true);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", handleExit);
    };

    child.once("exit", handleExit);
  });
}

async function stopPackagedApp(child) {
  if (await waitForProcessExit(child, 0)) {
    return;
  }

  child.kill("SIGTERM");
  if (await waitForProcessExit(child, exitTimeoutMs)) {
    return;
  }

  child.kill("SIGKILL");
  await waitForProcessExit(child, exitTimeoutMs);
}

async function smokePackagedApp() {
  if (process.platform !== "darwin") {
    throw new Error("Packaged desktop smoke only runs on macOS.");
  }

  const desktopVersion = await readDesktopPackageVersion();
  const appBinary = await resolvePackagedAppBinary();
  const authHelper = resolve(
    dirname(appBinary),
    "..",
    "Resources",
    "app.asar.unpacked",
    "dist",
    "password-manager-auth",
  );
  await access(authHelper, fsConstants.X_OK);
  execFileSync("codesign", ["--verify", authHelper], { stdio: "pipe" });
  await smokeOwnedPasswordManager(appBinary);
  // Exercise the packaged server's actual native dependencies in Electron's
  // Node runtime, not the checkout's Node or a renderer that attaches to a stub.
  const packagedManifest = resolve(
    dirname(appBinary),
    "..",
    "Resources",
    "app.asar",
    "node_modules",
    "patcher-app",
    "package.json",
  );
  execFileSync(
    appBinary,
    [
      "--eval",
      `
    const requirePackaged = require('node:module').createRequire(${JSON.stringify(packagedManifest)});
    const Database = requirePackaged('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE smoke (value INTEGER); INSERT INTO smoke VALUES (42)');
    if (db.prepare('SELECT value FROM smoke').get().value !== 42) throw new Error('Packaged SQLite query failed');
    db.close();
    const terminal = requirePackaged('node-pty').spawn('/bin/sh', ['-c', 'printf PATCHER_NATIVE_PTY_OK'], { cols: 80, rows: 24 });
    let output = '';
    const timer = setTimeout(() => { terminal.kill(); process.exit(1); }, 5000);
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode !== 0 || !output.includes('PATCHER_NATIVE_PTY_OK')) process.exit(1);
      console.log('Packaged SQLite query and PTY execution: passed');
    });
  `,
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 10_000,
      stdio: "inherit",
    },
  );
  const smokeRoot = await mkdtemp(
    join(tmpdir(), "patcher-desktop-packaged-smoke-"),
  );
  const dataDir = join(smokeRoot, "data");
  const userDataDir = join(smokeRoot, "user-data");
  const certificateServer = await startCertificateServer(smokeRoot);
  const smokeServer = await startSmokeServer({
    dataDir,
    expectedDesktopVersion: desktopVersion,
    certificateUrl: certificateServer.url,
  });
  const serverUrl = `http://127.0.0.1:${smokeServer.port}`;
  const stdout = [];
  const stderr = [];
  const childEnv = {
    ...process.env,
    PATCHER_DATA_DIR: dataDir,
    // The smoke server answers the Patcher probe, so a packaged build treats it as a
    // foreign Patcher and asks before attaching. No one is here to click, so opt out
    // and keep exercising the real attach path.
    PATCHER_DESKTOP_ATTACH_WITHOUT_PROMPT: "1",
    PATCHER_DESKTOP_OPEN_DEVTOOLS: "0",
    PATCHER_DESKTOP_VERSION_FEED_URL: `${serverUrl}/desktop-version.json`,
    PATCHER_SERVER_PORT: String(smokeServer.port),
  };
  delete childEnv.PATCHER_DESKTOP_APP_URL;
  delete childEnv.PATCHER_DESKTOP_NODE_EXEC_PATH;
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const child = spawn(
    appBinary,
    [
      `--user-data-dir=${userDataDir}`,
      // Give the fixture a public-looking hostname so requests exercise TLS
      // rejection rather than the browsing session's loopback firewall.
      "--host-resolver-rules=MAP certificate-smoke.test 127.0.0.1",
      "--no-proxy-server",
    ],
    { env: childEnv },
  );
  child.stdout.on("data", (chunk) => {
    appendOutput(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    appendOutput(stderr, chunk);
  });

  try {
    const preloadReady = await waitForPreloadReady({
      child,
      preloadReady: smokeServer.preloadReady,
      stdout,
      stderr,
    });
    if (!preloadReady.ok) {
      throw new Error(
        `Packaged desktop preload bridge did not become ready: ${preloadReady.reason}`,
      );
    }
    certificateServer.assertRejected();

    await sleep(postReadySettleMs);
    const nativeStatus = stdout
      .join("")
      .match(/Native Touch ID passkeys: ([^\n]+)/u)?.[1];
    if (!nativeStatus)
      throw new Error("Missing native passkey startup guard result.");
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Packaged Electron app exited after startup: code=${String(
          child.exitCode,
        )} signal=${String(child.signalCode)}.\n${formatProcessOutput({
          stdout,
          stderr,
        })}`,
      );
    }

    console.log(`Packaged desktop smoke passed: ${appBinary}`);
    console.log(
      "Concurrent untrusted certificate requests rejected without crashing: passed",
    );
    console.log(`Native passkey startup guard: ${nativeStatus}`);
  } finally {
    await stopPackagedApp(child);
    await smokeServer.close();
    await certificateServer.close();
    await rm(smokeRoot, { force: true, recursive: true });
  }
}

await smokePackagedApp().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : error;
  console.error(message);
  process.exitCode = 1;
});
