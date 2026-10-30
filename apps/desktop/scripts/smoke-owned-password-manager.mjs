import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function unusedPort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

/** Exercise the real packaged launcher/server pipe, including a persisted profile
 * and a blocking first Keychain call. No user profile or OS key is accessed. */
export async function smokeOwnedPasswordManager(appBinary) {
  const root = await mkdtemp(join(tmpdir(), "patcher-owned-password-smoke-"));
  try {
    const fixtureHome = join(root, "home");
    await mkdir(fixtureHome);
    const runtimePath = join(root, "runtime.cjs");
    await build({
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      stdin: {
        resolveDir: packageRoot,
        contents: `export { createDesktopSecretBroker } from "./src/desktop-secret-broker.ts";
          export { createDesktopSiteAuthority } from "./src/desktop-site-authority.ts";
          export { createPasswordManager } from "./src/password-manager.ts";
          export { fetchPasswordManagerMenuEnabled } from "./src/password-manager-menu-state.ts";`,
      },
      outfile: runtimePath,
    });
    const runtime = createRequire(import.meta.url)(runtimePath);
    const serverPort = await unusedPort(),
      daemonPort = await unusedPort();
    const bridge = resolve(
      dirname(appBinary),
      "../Resources/app.asar.unpacked/dist/patcher-app-bridge.mjs",
    );
    for (const delay of [0, 6500]) {
      const child = spawn(
        appBinary,
        [
          bridge,
          "--data-dir",
          join(root, "data"),
          "--server-port",
          String(serverPort),
          "--host-daemon-port",
          String(daemonPort),
        ],
        {
          detached: true,
          env: {
            PATH: process.env.PATH,
            HOME: fixtureHome,
            USER: process.env.USER,
            TMPDIR: process.env.TMPDIR,
            LANG: "en_US.UTF-8",
            NO_COLOR: "1",
            ELECTRON_RUN_AS_NODE: "1",
            NODE_ENV: "production",
            PATCHER_APP_SURFACE: "desktop",
            DO_NOT_TRACK: "1",
          },
          stdio: ["ignore", "pipe", "pipe", "pipe"],
        },
      );
      // Drain output without exposing runtime data or filling the pipe.
      child.stdout.resume();
      child.stderr.resume();
      let broker;
      const manager = runtime.createPasswordManager({
        store: (request) => broker.passwordManagerStore(request),
        key: () => {
          throw Error("An empty profile must not request a vault key");
        },
        authenticate: async () => false,
        changed() {},
      });
      const sites = runtime.createDesktopSiteAuthority({
        resolve: () => null,
        confirm: async () => false,
        changed: () => {
          if (
            sites.known("password-manager") &&
            !sites.enabled("password-manager")
          )
            manager.reset();
          void manager.refresh();
        },
      });
      let first = true;
      const backend = {
        available() {
          if (first) {
            first = false;
            // safeStorage.isEncryptionAvailable() can block during Keychain
            // initialization. The child can greet us while main is blocked.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
          }
          return true;
        },
        encrypt: (value) => Buffer.from(value),
        decrypt: (value) => value.toString(),
      };
      broker = runtime.createDesktopSecretBroker(
        child.stdio[3],
        backend,
        sites,
        undefined,
        (available) => {
          if (!available) manager.reset();
          void manager.refresh();
        },
      );
      void manager.refresh();
      try {
        const deadline = Date.now() + 15_000;
        let ready = false;
        while (Date.now() < deadline) {
          assert.equal(
            child.exitCode,
            null,
            "Owned runtime exited during startup",
          );
          assert.equal(
            child.stdio[3].destroyed,
            false,
            "Owned password channel closed during startup",
          );
          try {
            const status = await broker.passwordManagerStore({
              operation: "status",
            });
            ready = status.enabled === true && manager.enabled();
            if (ready) break;
          } catch {
            /* Not ready until the server and builtin registration load. */
          }
          await new Promise((done) => setTimeout(done, 50));
        }
        assert.ok(
          ready,
          "Enabled password manager never became available through the owned runtime",
        );
        await new Promise((done) => setTimeout(done, 250));
        assert.equal(
          manager.enabled(),
          true,
          "A late startup reply disabled the manager",
        );
        const menuRequest = {
          serverUrl: `http://127.0.0.1:${serverPort}`,
          fetchImpl: fetch,
          headers: {
            "x-patcher-app-key": (
              await readFile(join(root, "data", "app-api-key"), "utf8")
            ).trim(),
          },
        };
        assert.equal(
          await runtime.fetchPasswordManagerMenuEnabled(menuRequest),
          true,
        );
        broker.availability(false);
        assert.equal(
          await runtime.fetchPasswordManagerMenuEnabled(menuRequest),
          true,
          "Locking the vault must not hide the enabled plugin's menu entry",
        );
        console.log(
          `Owned manager profile ${delay === 0 ? "initial" : "existing with delayed Keychain"}: passed`,
        );
      } catch (error) {
        throw new Error(`Owned manager failed with Keychain delay ${delay}ms`, {
          cause: error,
        });
      } finally {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {}
        if (child.exitCode === null && child.signalCode === null)
          await Promise.race([
            new Promise((done) => child.once("exit", done)),
            new Promise((done) => setTimeout(done, 5000)),
          ]);
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
        broker.close();
      }
    }
    console.log(
      "Packaged password manager: fresh and existing profiles survive blocking Keychain startup",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
