import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ensureNativeModules,
  refreshNativeBindings,
  verifyNativeModule,
} from "../../../scripts/ensure-native-modules.mjs";

const scriptUrl = new URL(
  "../../../scripts/ensure-native-modules.mjs",
  import.meta.url,
).href;

function createBetterSqliteRequire(initialError) {
  const state = {
    constructorError: initialError,
    constructorCalls: 0,
  };

  function Database() {
    state.constructorCalls += 1;
    if (state.constructorError !== null) {
      throw state.constructorError;
    }
  }

  Database.prototype.close = vi.fn();

  function requireModule(request) {
    if (request !== "better-sqlite3") {
      throw new Error(`Unexpected require: ${request}`);
    }

    return Database;
  }

  requireModule.resolve = (request) => {
    if (request === "better-sqlite3/package.json") {
      return "/tmp/fake-node-modules/better-sqlite3/package.json";
    }

    if (request === "prebuild-install/bin.js") {
      return "/tmp/fake-node-modules/prebuild-install/bin.js";
    }

    if (request === "node-gyp/bin/node-gyp.js") {
      return "/tmp/fake-node-modules/node-gyp/bin/node-gyp.js";
    }

    throw new Error(`Unexpected resolve: ${request}`);
  };

  return {
    requireModule,
    state,
    clearConstructorError() {
      state.constructorError = null;
    },
  };
}

function createEnsureOptions(fakeRequire, execFileSync) {
  return {
    repoRoot: "/repo",
    modules: [
      { name: "better-sqlite3", resolveFrom: "packages/db/package.json" },
    ],
    createRequire: () => fakeRequire,
    execFileSync,
    verifyRepairedNativeModule(name) {
      try {
        verifyNativeModule(name, fakeRequire);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    log: vi.fn(),
  };
}

describe("refreshNativeBindings", () => {
  it("replaces each binding with an identical file on a new inode", () => {
    const dir = mkdtempSync(join(tmpdir(), "patcher-native-refresh-"));
    const releaseDir = join(dir, "build", "Release");
    mkdirSync(releaseDir, { recursive: true });
    const binding = join(releaseDir, "better_sqlite3.node");
    writeFileSync(binding, "binary-bytes");
    writeFileSync(join(releaseDir, "notes.txt"), "left alone");
    const before = statSync(binding).ino;
    const beforeText = statSync(join(releaseDir, "notes.txt")).ino;

    refreshNativeBindings(dir);

    // Same bytes, different inode — which is the whole point: the kernel's
    // cached signature pages are keyed to the vnode, not to the contents.
    expect(readFileSync(binding, "utf8")).toBe("binary-bytes");
    expect(statSync(binding).ino).not.toBe(before);
    // Only compiled bindings are touched.
    expect(statSync(join(releaseDir, "notes.txt")).ino).toBe(beforeText);
    // And no staging file is left behind.
    expect(readdirSync(releaseDir).sort()).toEqual([
      "better_sqlite3.node",
      "notes.txt",
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing when the package has no compiled output", () => {
    const dir = mkdtempSync(join(tmpdir(), "patcher-native-refresh-"));

    expect(() => refreshNativeBindings(dir)).not.toThrow();

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("ensure-native-modules", () => {
  it("does not detect a better-sqlite3 ABI mismatch by requiring the wrapper only", () => {
    const abiError = new Error(
      "The module was compiled against a different NODE_MODULE_VERSION",
    );
    const { requireModule, state } = createBetterSqliteRequire(abiError);

    expect(() => requireModule("better-sqlite3")).not.toThrow();
    expect(state.constructorCalls).toBe(0);
    expect(() => verifyNativeModule("better-sqlite3", requireModule)).toThrow(
      /NODE_MODULE_VERSION/,
    );
    expect(state.constructorCalls).toBe(1);
  });

  it("rechecks better-sqlite3 after installing a prebuilt binary", () => {
    const abiError = new Error(
      "The module was compiled against a different NODE_MODULE_VERSION",
    );
    const fake = createBetterSqliteRequire(abiError);
    const execFileSync = vi.fn(() => {
      fake.clearConstructorError();
    });

    expect(() =>
      ensureNativeModules(
        createEnsureOptions(fake.requireModule, execFileSync),
      ),
    ).not.toThrow();

    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      ["/tmp/fake-node-modules/prebuild-install/bin.js"],
      expect.objectContaining({
        cwd: "/tmp/fake-node-modules/better-sqlite3",
        encoding: "utf8",
        env: expect.objectContaining({ npm_config_loglevel: "info" }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(fake.state.constructorCalls).toBe(2);
  });

  it("accepts a prebuilt binary that loads after the installer exits non-zero", () => {
    const abiError = new Error(
      "The module was compiled against a different NODE_MODULE_VERSION",
    );
    const fake = createBetterSqliteRequire(abiError);
    const prebuildError = Object.assign(
      new Error("Command failed: prebuild-install"),
      {
        status: 1,
        stderr:
          "prebuild-install info unpack resolved to /tmp/fake-node-modules/better-sqlite3/build/Release/better_sqlite3.node\n",
      },
    );
    const execFileSync = vi.fn((nodePath, args) => {
      if (args[0] === "/tmp/fake-node-modules/prebuild-install/bin.js") {
        fake.clearConstructorError();
        throw prebuildError;
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });
    const options = createEnsureOptions(fake.requireModule, execFileSync);

    expect(() => ensureNativeModules(options)).not.toThrow();

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(fake.state.constructorCalls).toBe(2);
    expect(options.log).toHaveBeenCalledWith(
      "[ensure-native-modules] Prebuilt better-sqlite3 loaded despite installer failure",
    );
  });

  it("falls back to a source rebuild when prebuild repair fails", () => {
    const missingBindingError = new Error(
      "Could not locate the bindings file. Tried: build/Release/better_sqlite3.node",
    );
    const fake = createBetterSqliteRequire(missingBindingError);
    const prebuildError = Object.assign(
      new Error("Command failed: prebuild-install"),
      {
        status: 1,
        stderr:
          "prebuild-install info install --build-from-source specified, not attempting download.\n",
      },
    );
    const execFileSync = vi.fn((nodePath, args) => {
      if (args[0] === "/tmp/fake-node-modules/prebuild-install/bin.js") {
        throw prebuildError;
      }
      fake.clearConstructorError();
    });
    const options = createEnsureOptions(fake.requireModule, execFileSync);

    expect(() => ensureNativeModules(options)).not.toThrow();

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      ["/tmp/fake-node-modules/prebuild-install/bin.js"],
      expect.objectContaining({
        cwd: "/tmp/fake-node-modules/better-sqlite3",
        encoding: "utf8",
        env: expect.objectContaining({ npm_config_loglevel: "info" }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [
        "/tmp/fake-node-modules/node-gyp/bin/node-gyp.js",
        "rebuild",
        "--release",
      ],
      {
        cwd: "/tmp/fake-node-modules/better-sqlite3",
        stdio: "inherit",
      },
    );
    expect(fake.state.constructorCalls).toBe(3);
    expect(options.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "stderr: prebuild-install info install --build-from-source specified",
      ),
    );
    expect(options.log).toHaveBeenCalledWith(
      expect.stringContaining("Prebuilt better-sqlite3 still failed to load"),
    );
  });

  it("rebuilds from source when an installed prebuild is still ABI-mismatched", () => {
    const abiError = new Error(
      "The module was compiled against a different NODE_MODULE_VERSION",
    );
    const fake = createBetterSqliteRequire(abiError);
    const execFileSync = vi.fn((nodePath, args) => {
      if (args[0] === "/tmp/fake-node-modules/node-gyp/bin/node-gyp.js") {
        fake.clearConstructorError();
      }
    });

    expect(() =>
      ensureNativeModules(
        createEnsureOptions(fake.requireModule, execFileSync),
      ),
    ).not.toThrow();

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      ["/tmp/fake-node-modules/prebuild-install/bin.js"],
      expect.objectContaining({
        cwd: "/tmp/fake-node-modules/better-sqlite3",
        encoding: "utf8",
        env: expect.objectContaining({ npm_config_loglevel: "info" }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [
        "/tmp/fake-node-modules/node-gyp/bin/node-gyp.js",
        "rebuild",
        "--release",
      ],
      {
        cwd: "/tmp/fake-node-modules/better-sqlite3",
        stdio: "inherit",
      },
    );
    expect(fake.state.constructorCalls).toBe(3);
  });

  it("rebuilds when Node reports that the native module did not self-register", () => {
    const registrationError = new Error(
      "Module did not self-register: '/tmp/better_sqlite3.node'",
    );
    const fake = createBetterSqliteRequire(registrationError);
    const execFileSync = vi.fn((nodePath, args) => {
      if (args[0] === "/tmp/fake-node-modules/node-gyp/bin/node-gyp.js") {
        fake.clearConstructorError();
      }
    });

    expect(() =>
      ensureNativeModules(
        createEnsureOptions(fake.requireModule, execFileSync),
      ),
    ).not.toThrow();

    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(fake.state.constructorCalls).toBe(3);
  });

  // The failure this whole child-process arrangement exists for: macOS kills a
  // process that maps a native module whose cached signature pages are stale,
  // so the load reports no error at all — just a dead child.
  it("repairs a binary macOS refuses to map, instead of dying with it", () => {
    const fake = createBetterSqliteRequire(null);
    const failures = [
      "Command failed: node --input-type=module\nsignal: SIGKILL",
      null,
    ];
    const execFileSync = vi.fn();
    const options = {
      ...createEnsureOptions(fake.requireModule, execFileSync),
      refreshNativeBindings: vi.fn(),
      verifyRepairedNativeModule: () => failures.shift() ?? null,
    };

    expect(() => ensureNativeModules(options)).not.toThrow();

    // Prebuild reinstall ran, and nothing escalated to a source rebuild.
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      ["/tmp/fake-node-modules/prebuild-install/bin.js"],
      expect.objectContaining({ cwd: "/tmp/fake-node-modules/better-sqlite3" }),
    );
  });

  // The installer writes in place, which is what leaves the stale pages behind,
  // so the refresh has to happen between writing and loading — every time,
  // including when the installer itself reported failure.
  it("refreshes the bindings after writing them and before verifying", () => {
    const abiError = new Error(
      "The module was compiled against a different NODE_MODULE_VERSION",
    );
    const fake = createBetterSqliteRequire(abiError);
    const order = [];
    const execFileSync = vi.fn((nodePath, args) => {
      order.push(args[0].includes("prebuild-install") ? "install" : "rebuild");
      fake.clearConstructorError();
    });
    const options = {
      ...createEnsureOptions(fake.requireModule, execFileSync),
      refreshNativeBindings: vi.fn(() => order.push("refresh")),
    };
    const verifyRepaired = options.verifyRepairedNativeModule;
    options.verifyRepairedNativeModule = (...args) => {
      const result = verifyRepaired(...args);
      order.push(result === null ? "verify-ok" : "verify-fail");
      return result;
    };

    ensureNativeModules(options);

    expect(options.refreshNativeBindings).toHaveBeenCalledWith(
      "/tmp/fake-node-modules/better-sqlite3",
    );
    expect(order).toEqual(["verify-fail", "install", "refresh", "verify-ok"]);
  });

  // Loading the module in this process is the thing that cannot be allowed:
  // a SIGKILL here takes the dev session down with the script.
  it("never loads the module in the calling process", () => {
    const fake = createBetterSqliteRequire(null);
    const requireModule = (request) => {
      throw new Error(`must not require ${request} in-process`);
    };
    requireModule.resolve = fake.requireModule.resolve;

    expect(() =>
      ensureNativeModules({
        repoRoot: "/repo",
        modules: [
          { name: "better-sqlite3", resolveFrom: "packages/db/package.json" },
        ],
        createRequire: () => requireModule,
        execFileSync: vi.fn(),
        refreshNativeBindings: vi.fn(),
        verifyRepairedNativeModule: () => null,
        log: vi.fn(),
      }),
    ).not.toThrow();
  });

  it("exits non-zero when the post-rebuild instantiation still fails", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          import { ensureNativeModules } from ${JSON.stringify(scriptUrl)};

          function createRequire() {
            function Database() {
              throw new Error("Wrong native binary NODE_MODULE_VERSION");
            }

            function requireModule(request) {
              if (request !== "better-sqlite3") {
                throw new Error("Unexpected require: " + request);
              }

              return Database;
            }

            requireModule.resolve = () => "/tmp/fake-node-modules/better-sqlite3/package.json";
            return requireModule;
          }

          ensureNativeModules({
            repoRoot: "/repo",
            modules: [{ name: "better-sqlite3", resolveFrom: "packages/db/package.json" }],
            createRequire,
            execFileSync() {},
            verifyRepairedNativeModule() {
              return "Wrong native binary NODE_MODULE_VERSION";
            },
            log() {},
          });
        `,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "better-sqlite3 still failed to load after rebuild",
    );
  });
});
