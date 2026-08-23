/**
 * Does a runtime support the two native modules the workspace cannot do
 * without? Run it under both to compare:
 *
 *   node scripts/check-bun-native.mjs
 *   bun  scripts/check-bun-native.mjs
 *
 * Written for the Phase 7 question "can a plugin host run on Bun". The
 * recorded answers, and what they cost, are in
 * docs/architecture/bb-migration.md § "Bun as a runtime". Re-run this before
 * trusting them against a newer Bun.
 *
 * Exit code 0 means both modules work; the runtime name and per-step results
 * are printed either way.
 */
import { fstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function runtimeName() {
  // Bun reports a Node version too, so the Bun marker has to be checked first.
  const bun = process.versions.bun;
  return bun
    ? `bun ${bun} (claims node ${process.versions.node}, ABI ${process.versions.modules})`
    : `node ${process.versions.node} (ABI ${process.versions.modules})`;
}

/** Resolve a workspace native module the way ensure-native-modules.mjs does. */
function packageDir(name, resolveFrom) {
  const requireFrom = createRequire(resolve(repoRoot, resolveFrom));
  return dirname(requireFrom.resolve(`${name}/package.json`));
}

const results = [];
function record(step, outcome, detail) {
  results.push({ step, outcome, detail });
  const mark = outcome === "ok" ? "ok  " : "FAIL";
  console.log(
    `  ${mark} ${step}${detail === undefined ? "" : ` -> ${detail}`}`,
  );
}

function checkSqlite() {
  console.log("better-sqlite3");
  let dir;
  try {
    const Database = createRequire(import.meta.url)(
      packageDir("better-sqlite3", "packages/db/package.json"),
    );
    record("require", "ok", typeof Database);

    dir = mkdtempSync(join(tmpdir(), "patcher-native-check-"));
    const db = new Database(join(dir, "probe.db"));
    record(
      "open + WAL",
      "ok",
      db.pragma("journal_mode = WAL", { simple: true }),
    );

    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, blob BLOB)");
    const insert = db.prepare("INSERT INTO t (name, blob) VALUES (?, ?)");
    insert.run("строка", Buffer.from([1, 2, 3]));
    db.transaction((rows) => {
      for (const row of rows) insert.run(row, null);
    })(Array.from({ length: 500 }, (_, i) => `row-${i}`));
    record(
      "insert + transaction",
      "ok",
      `${db.prepare("SELECT count(*) AS n FROM t").get().n} rows`,
    );

    const row = db.prepare("SELECT name, blob FROM t WHERE id = 1").get();
    const ok = row.name === "строка" && Buffer.isBuffer(row.blob);
    record("read back utf-8 + blob", ok ? "ok" : "fail", row.name);

    db.close();
    record("close", "ok");
  } catch (error) {
    record("usable", "fail", error.message.split("\n")[0]);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

async function checkPty() {
  console.log("node-pty");
  const marker = join(tmpdir(), `patcher-native-check-pty-${process.pid}.txt`);
  rmSync(marker, { force: true });
  let term;
  try {
    const pty = createRequire(import.meta.url)(
      packageDir("node-pty", "apps/host-daemon/package.json"),
    );
    record("require", "ok", typeof pty.spawn);

    term = pty.spawn("/bin/sh", [], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME,
      env: process.env,
    });
    record("spawn", "ok", `pid=${term.pid}`);

    let output = "";
    term.onData((data) => {
      output += data;
    });
    term.write(`echo RAN > ${marker}; echo BACK-CHANNEL\r`);
    await wait(1200);

    // The shell writes to a file, because onData alone cannot tell execution
    // from the tty echoing back the characters we just typed. For the same
    // reason the back-channel needs a *second* occurrence: typed once, and
    // printed once by the shell.
    let executed = false;
    try {
      executed = readFileSync(marker, "utf8").includes("RAN");
    } catch {
      executed = false;
    }
    record("shell executed the command", executed ? "ok" : "fail");
    const returned = output.split("BACK-CHANNEL").length - 1 >= 2;
    record(
      "output came back",
      returned ? "ok" : "fail",
      `${output.length} bytes`,
    );

    try {
      term.resize(120, 40);
      record("resize", "ok");
    } catch (error) {
      record("resize", "fail", error.message);
    }

    // The master descriptor is the thing that actually goes missing under Bun,
    // so report it directly rather than only through the symptoms above.
    let fdState = "valid";
    try {
      fstatSync(term.fd);
    } catch (error) {
      fdState = error.code ?? error.message;
    }
    record(
      "master fd still open",
      fdState === "valid" ? "ok" : "fail",
      fdState,
    );
  } catch (error) {
    record("usable", "fail", error.message.split("\n")[0]);
  } finally {
    rmSync(marker, { force: true });
    try {
      term?.kill();
    } catch {
      // Already gone, which is itself one of the failure modes.
    }
  }
}

console.log(`runtime: ${runtimeName()}\n`);
checkSqlite();
console.log();
await checkPty();

const failed = results.filter((r) => r.outcome !== "ok");
console.log(
  `\n${results.length - failed.length}/${results.length} steps passed` +
    (failed.length ? `; failed: ${failed.map((r) => r.step).join(", ")}` : ""),
);
process.exit(failed.length ? 1 : 0);
