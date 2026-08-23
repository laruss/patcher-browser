/**
 * What a plugin host process costs before it loads a single plugin.
 *
 * Placement policy is decided by this number (see plugin-supervisor.ts): while
 * a host process costs a few hundred megabytes, one process per plugin is not
 * something a desktop browser can spend, and plugins have to share a process.
 * So it is measured rather than argued about, and every import is attributed.
 *
 * Two things this measures that a bundle size does not. It builds with the
 * production settings (`scripts/build-node-entry.mjs`), because a source
 * checkout runs under tsx and tsx is tens of megabytes of its own. And it
 * reads **resident memory of a real forked process**, because what a package
 * costs is what it does when it runs — zod builds schema objects, luxon builds
 * locale tables — not how many bytes of it were bundled.
 *
 * Run: node apps/server/scripts/measure-plugin-host.mjs
 */

import { execFileSync, fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNodeEsmEntry } from "../../../scripts/build-utils.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST_ENTRY = join(
  PACKAGE_ROOT,
  "src/services/plugins/plugin-host-entry.ts",
);

/**
 * What the host's import graph is made of, each measured on its own.
 *
 * Every entry *uses* what it imports. A bare `import "zod"` measures nothing:
 * the package declares `sideEffects: false`, the bundler drops it, and the
 * answer comes back as 0.1MB.
 */
const PARTS = [
  ["nothing (bare node)", `console.error("idle");`],
  [
    "hono",
    `import {Hono} from "hono"; console.error(typeof new Hono().fetch);`,
  ],
  [
    "better-sqlite3",
    `import D from "better-sqlite3"; console.error(typeof D);`,
  ],
  [
    "cron-parser (pulls luxon)",
    `import {CronExpressionParser as C} from "cron-parser"; console.error(typeof C.parse("0 3 * * *"));`,
  ],
  [
    "zod, used",
    `import {z} from "zod"; console.error(typeof z.object({a: z.string()}).safeParse({a: "b"}));`,
  ],
  [
    "@patcher/domain/browser-control",
    `import {browserCookieSchema} from "@patcher/domain/browser-control"; console.error(typeof browserCookieSchema);`,
  ],
  [
    "@patcher/domain/plugin-permissions",
    `import {PLUGIN_PERMISSIONS} from "@patcher/domain/plugin-permissions"; console.error(PLUGIN_PERMISSIONS.length);`,
  ],
  [
    "@patcher/domain/app-keybindings",
    `import {appCommandIdSchema} from "@patcher/domain/app-keybindings"; console.error(typeof appCommandIdSchema.safeParse("x"));`,
  ],
  [
    "@patcher/domain/pending-interactions",
    `import {PLUGIN_INTERACTION_MAX_TITLE_LENGTH as L} from "@patcher/domain/pending-interactions"; console.error(L);`,
  ],
  [
    "@patcher/domain (whole index)",
    `import {PLUGIN_PERMISSIONS} from "@patcher/domain"; console.error(PLUGIN_PERMISSIONS.length);`,
  ],
  [
    "plugin-channel.ts (transport only)",
    `import {createPluginChannel} from "${PACKAGE_ROOT}src/services/plugins/plugin-channel.ts"; console.error(typeof createPluginChannel);`,
  ],
  [
    "plugin-api.ts (the whole Patcher builder)",
    `import {createPluginApi} from "${PACKAGE_ROOT}src/services/plugins/plugin-api.ts"; console.error(typeof createPluginApi);`,
  ],
  [
    "plugin-child-runtime.ts (the host's own graph)",
    `import {createPluginChildRuntime} from "${PACKAGE_ROOT}src/services/plugins/plugin-child-runtime.ts"; console.error(typeof createPluginChildRuntime);`,
  ],
  [
    "@patcher/sdk (pulls the API client)",
    `import {createNodePatcherSdk} from "@patcher/sdk"; console.error(typeof createNodePatcherSdk);`,
  ],
];

async function bundle(source, outfile) {
  const entry = `${outfile}.entry.mjs`;
  await writeFile(entry, `${source}\nsetInterval(() => {}, 1000);\n`);
  await buildNodeEsmEntry({
    entryPoint: entry,
    outfile,
    packageRoot: PACKAGE_ROOT,
    sourcemap: false,
  });
}

/**
 * Resident memory of a forked process, read from outside. The bundle lands in
 * the package's own `dist` because that is where the real one lives: natives
 * stay external, so the process has to be somewhere `better-sqlite3` resolves.
 */
async function residentMb(bundlePath) {
  const child = fork(bundlePath, [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    if (child.exitCode !== null) return Number.NaN;
    const rss = execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
      encoding: "utf8",
    });
    return Number(rss.trim()) / 1024;
  } finally {
    child.kill();
  }
}

const workDir = await mkdtemp(join(PACKAGE_ROOT, "dist", "measure-"));
try {
  const rows = [];
  for (const [name, source] of PARTS) {
    const outfile = join(workDir, `${rows.length}.js`);
    await bundle(source, outfile);
    rows.push({ name, mb: await residentMb(outfile) });
  }

  const hostBundle = join(workDir, "host.js");
  await buildNodeEsmEntry({
    entryPoint: HOST_ENTRY,
    outfile: hostBundle,
    packageRoot: PACKAGE_ROOT,
    sourcemap: false,
  });
  const host = await residentMb(hostBundle);

  const baseline = rows[0].mb;
  const pad = Math.max(...rows.map((row) => row.name.length));
  console.log(`${"import".padEnd(pad)}   resident MB   over baseline`);
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(pad)}   ${row.mb.toFixed(1).padStart(11)}   ${(
        row.mb - baseline
      )
        .toFixed(1)
        .padStart(13)}`,
    );
  }
  console.log(
    `\nplugin host, as built and forked: ${host.toFixed(1)} MB ` +
      `(${(host - baseline).toFixed(1)} MB over a bare node process)`,
  );
} finally {
  await rm(workDir, { force: true, recursive: true });
}
