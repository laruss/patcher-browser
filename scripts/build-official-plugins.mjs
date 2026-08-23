import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPluginApp,
  buildPluginServer,
  resolvePluginBuildToolchain,
} from "../packages/plugin-build/src/index.ts";
import { OFFICIAL_PLUGINS } from "../apps/server/src/services/plugins/builtin-registry.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
// Derived from the registry, so a new store-only plugin needs no edit here.
const officialNames = OFFICIAL_PLUGINS.map((plugin) => plugin.name);

const requested = process.argv.slice(2);
const selected =
  requested.length === 0 || requested.includes("all")
    ? officialNames
    : requested;

// Resolves from this repo's own devDependencies; no download here.
const toolchain = await resolvePluginBuildToolchain(
  resolve(repositoryRoot, "node_modules/.patcher-toolchain"),
);

for (const plugin of selected) {
  if (!officialNames.includes(plugin)) {
    throw new Error(
      `unknown official plugin ${JSON.stringify(plugin)}; expected ${officialNames.join(", ")}, or all`,
    );
  }
}

const patcherPackage = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "packages/patcher-app/package.json"),
    "utf8",
  ),
);
if (typeof patcherPackage.version !== "string") {
  throw new Error("packages/patcher-app/package.json is missing a version");
}

for (const plugin of selected) {
  const rootDirectory = resolve(repositoryRoot, "plugins", plugin);
  await rm(resolve(rootDirectory, "dist"), { recursive: true, force: true });

  const server = await buildPluginServer(
    rootDirectory,
    patcherPackage.version,
    toolchain,
  );
  const app = await buildPluginApp(
    rootDirectory,
    patcherPackage.version,
    toolchain,
  );
  console.log(
    `${plugin}: built ${server.jsPath}, ${server.metaPath}, ${app.jsPath}, ${app.cssPath}, and ${app.metaPath}`,
  );
}
