import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(fileURLToPath(import.meta.url), "../..");

export const nativeModules = [
  { name: "better-sqlite3", resolveFrom: "packages/db/package.json" },
];

function formatThrownValue(err) {
  return err instanceof Error ? err.message : String(err);
}

function formatChildProcessFailure(err) {
  const details = [formatThrownValue(err).split("\n")[0]];
  if (err && typeof err === "object") {
    if ("status" in err && err.status !== null && err.status !== undefined) {
      details.push(`exit status: ${String(err.status)}`);
    }
    if ("signal" in err && err.signal !== null && err.signal !== undefined) {
      details.push(`signal: ${String(err.signal)}`);
    }

    for (const streamName of ["stdout", "stderr"]) {
      const output = err[streamName];
      if (output === undefined || output === null) continue;

      const text = Buffer.isBuffer(output)
        ? output.toString("utf8")
        : String(output);
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        details.push(`${streamName}: ${trimmed}`);
      }
    }
  }

  return details.join("\n");
}

export function verifyNativeModule(name, requireModule) {
  const module = requireModule(name);
  if (name !== "better-sqlite3") {
    return;
  }

  const db = new module(":memory:");
  db.close();
}

function shouldRebuildNativeModule(errorMessage) {
  return (
    // `signal: SIGKILL` is macOS refusing to map the binary at all — see
    // refreshNativeBindings. The verification child does nothing but load the
    // module, so a kill is about the module rather than about the machine.
    /NODE_MODULE_VERSION|Could not locate the bindings file|Module did not self-register|signal: SIGKILL|Code Signature Invalid/.test(
      errorMessage,
    )
  );
}

/**
 * Rewrite every compiled binding under `build/Release` through a fresh inode.
 *
 * macOS caches a mach-o's code-signature page hashes against the vnode. A
 * writer that replaces a `.node` **in place** — which is what unpacking a
 * prebuild over an existing build does — leaves those hashes describing the
 * old bytes, so the next `dlopen` faults a page that no longer matches them.
 * The kernel does not return an error for that: it kills the process outright
 * with SIGKILL (`EXC_BAD_ACCESS`, "Code Signature Invalid", exit 137), before
 * any JavaScript can see it.
 *
 * That failure is unusually hard to read, which is why this is worth doing
 * unconditionally rather than on suspicion: `codesign -v` still passes, because
 * the bytes on disk are correct and only the cached hashes are stale. Copy and
 * rename gives the next mapping a vnode that has no cached hashes at all.
 */
export function refreshNativeBindings(pkgDir) {
  const releaseDir = join(pkgDir, "build", "Release");
  let entries;
  try {
    entries = readdirSync(releaseDir);
  } catch {
    // No compiled output at the usual path; nothing to refresh.
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".node")) continue;
    const target = join(releaseDir, entry);
    const staging = `${target}.refresh`;
    copyFileSync(target, staging);
    renameSync(staging, target);
  }
}

function getRepairedNativeModuleError(name, pkgJsonPath) {
  try {
    // A failed dlopen remains cached for the life of the process. Verify a
    // replacement binary in a fresh process so the old handle cannot poison it.
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { createRequire } from "node:module";
const requireModule = createRequire(${JSON.stringify(pkgJsonPath)});
const NativeModule = requireModule(${JSON.stringify(name)});
const instance = new NativeModule(":memory:");
instance.close();`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return null;
  } catch (err) {
    const message = formatChildProcessFailure(err);
    if (!shouldRebuildNativeModule(message)) throw err;
    return message;
  }
}

export function ensureNativeModules({
  repoRoot = defaultRepoRoot,
  modules = nativeModules,
  createRequire: createRequireImpl = createRequire,
  execFileSync: execFileSyncImpl = execFileSync,
  refreshNativeBindings: refreshNativeBindingsImpl = refreshNativeBindings,
  verifyRepairedNativeModule:
    verifyRepairedNativeModuleImpl = getRepairedNativeModuleError,
  log = console.log,
} = {}) {
  for (const { name, resolveFrom } of modules) {
    const requireModule = createRequireImpl(resolve(repoRoot, resolveFrom));
    const pkgJsonPath = requireModule.resolve(`${name}/package.json`);
    const pkgDir = dirname(pkgJsonPath);

    // Even the *first* check runs in a child process, because loading a native
    // module is not always a catchable failure: a binary macOS refuses to map
    // takes the whole process down with SIGKILL. Doing it here would kill this
    // script — and, since `patcher-dev-app` runs it, the dev session with it —
    // before any repair could run. A child can die; this loop cannot.
    const initialFailure = verifyRepairedNativeModuleImpl(name, pkgJsonPath);
    if (initialFailure === null) continue;

    const pkgRequire = createRequireImpl(pkgJsonPath);
    log(
      `[ensure-native-modules] Installing prebuilt ${name} for Node ${process.versions.node} (ABI ${process.versions.modules})`,
    );
    let prebuildInstalled = false;
    try {
      execFileSyncImpl(
        process.execPath,
        [pkgRequire.resolve("prebuild-install/bin.js")],
        {
          cwd: pkgDir,
          encoding: "utf8",
          env: { ...process.env, npm_config_loglevel: "info" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      prebuildInstalled = true;
    } catch (prebuildErr) {
      const message = formatChildProcessFailure(prebuildErr);
      log(
        `[ensure-native-modules] Prebuilt ${name} unavailable or unusable: ${message}`,
      );
    }

    // Unconditionally, and before verifying: whatever just wrote here wrote in
    // place, and that alone is enough to make the next load a SIGKILL.
    refreshNativeBindingsImpl(pkgDir);

    const prebuildVerifyError = verifyRepairedNativeModuleImpl(
      name,
      pkgJsonPath,
    );
    if (prebuildVerifyError === null) {
      if (!prebuildInstalled) {
        log(
          `[ensure-native-modules] Prebuilt ${name} loaded despite installer failure`,
        );
      }
      continue;
    }

    if (prebuildInstalled) {
      log(
        `[ensure-native-modules] Prebuilt ${name} failed to load: ${prebuildVerifyError}`,
      );
    } else {
      log(
        `[ensure-native-modules] Prebuilt ${name} still failed to load: ${prebuildVerifyError}`,
      );
    }

    log(
      `[ensure-native-modules] Rebuilding ${name} from source for Node ${process.versions.node} (ABI ${process.versions.modules})`,
    );
    execFileSyncImpl(
      process.execPath,
      [pkgRequire.resolve("node-gyp/bin/node-gyp.js"), "rebuild", "--release"],
      {
        cwd: pkgDir,
        stdio: "inherit",
      },
    );

    refreshNativeBindingsImpl(pkgDir);

    const rebuildVerifyError = verifyRepairedNativeModuleImpl(
      name,
      pkgJsonPath,
    );
    if (rebuildVerifyError !== null) {
      throw new Error(
        `[ensure-native-modules] ${name} still failed to load after rebuild: ${rebuildVerifyError}`,
      );
    }
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  ensureNativeModules();
}
