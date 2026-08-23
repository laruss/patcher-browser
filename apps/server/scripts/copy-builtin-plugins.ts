import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  buildPluginApp,
  buildPluginServer,
  resolvePluginBuildToolchain,
} from "@patcher/plugin-build";
import {
  isPluginOwnedIconPath,
  pluginPackageJsonSchema,
} from "@patcher/domain";
import { z } from "zod";
import {
  BUILTIN_PLUGINS_DIRECTORY_NAME,
  BUNDLED_PLUGINS,
  resolveBuiltinPluginRootPathForModuleDir,
  type BundledPluginDefinition,
} from "../src/services/plugins/builtin-registry.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const sourceModuleDir = path.resolve(serverRoot, "src", "services", "plugins");
const targetRoot = path.resolve(
  serverRoot,
  "dist",
  BUILTIN_PLUGINS_DIRECTORY_NAME,
);
const patcherAppPackageJsonPath = path.resolve(
  serverRoot,
  "..",
  "..",
  "packages",
  "patcher-app",
  "package.json",
);

const RUNTIME_DIRS = ["dist", "skills"] as const;

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readAuthoritativePatcherVersion(): Promise<string> {
  try {
    const json: unknown = JSON.parse(
      await readFile(patcherAppPackageJsonPath, "utf8"),
    );
    const parsed = z.object({ version: z.string().min(1) }).safeParse(json);
    if (parsed.success) return parsed.data.version;
  } catch (error) {
    throw new Error(
      `cannot read authoritative patcher version from ${patcherAppPackageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new Error(
    `cannot read authoritative patcher version from ${patcherAppPackageJsonPath}`,
  );
}

async function copyIfExists(from: string, to: string): Promise<void> {
  if (await exists(from)) {
    await cp(from, to, { recursive: true });
  }
}

async function writeRuntimePackageJson(args: {
  sourceRoot: string;
  targetDir: string;
}): Promise<void> {
  const raw = await readFile(
    path.join(args.sourceRoot, "package.json"),
    "utf8",
  );
  const packageJson = pluginPackageJsonSchema.parse(JSON.parse(raw));
  await writeFile(
    path.join(args.targetDir, "package.json"),
    `${JSON.stringify(
      {
        ...packageJson,
        patcher: {
          ...packageJson.patcher,
          server: "./dist/server.js",
          ...(packageJson.patcher.app === undefined
            ? {}
            : { app: "./dist/app.js" }),
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function copyBuiltinPlugin(args: {
  patcherVersion: string;
  build: boolean;
  name: string;
  sourceRoot: string;
  targetRoot: string;
}): Promise<void> {
  if (args.build) {
    // Resolves from this repo's own devDependencies; no download here.
    const toolchain = await resolvePluginBuildToolchain(
      path.join(serverRoot, "node_modules", ".patcher-toolchain"),
    );
    await buildPluginServer(args.sourceRoot, args.patcherVersion, toolchain);
    const raw = await readFile(
      path.join(args.sourceRoot, "package.json"),
      "utf8",
    );
    const packageJson = pluginPackageJsonSchema.parse(JSON.parse(raw));
    if (packageJson.patcher.app !== undefined) {
      await buildPluginApp(args.sourceRoot, args.patcherVersion, toolchain);
    }
  }

  const targetDir = path.join(args.targetRoot, args.name);
  await mkdir(targetDir, { recursive: true });

  await writeRuntimePackageJson({
    sourceRoot: args.sourceRoot,
    targetDir,
  });
  for (const dirName of RUNTIME_DIRS) {
    await copyIfExists(
      path.join(args.sourceRoot, dirName),
      path.join(targetDir, dirName),
    );
  }
  const packageJson = pluginPackageJsonSchema.parse(
    JSON.parse(
      await readFile(path.join(args.sourceRoot, "package.json"), "utf8"),
    ),
  );
  const logo = packageJson.patcher.branding.logo;
  const compactIcon = isPluginOwnedIconPath(
    packageJson.patcher.branding.icon ?? "",
  )
    ? packageJson.patcher.branding.icon
    : undefined;
  for (const asset of [compactIcon, logo?.light, logo?.dark]) {
    if (asset === undefined) continue;
    const sourcePath = path.resolve(args.sourceRoot, asset);
    const targetPath = path.resolve(targetDir, asset);
    if (
      (sourcePath !== args.sourceRoot &&
        !sourcePath.startsWith(args.sourceRoot + path.sep)) ||
      (targetPath !== targetDir && !targetPath.startsWith(targetDir + path.sep))
    ) {
      throw new Error(
        `manifest branding asset escapes plugin directory: ${asset}`,
      );
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath);
  }
}

export async function copyBuiltinPlugins(args: {
  patcherVersion: string;
  build?: boolean;
  plugins?: readonly Pick<BundledPluginDefinition, "name">[];
  sourceModuleDir?: string;
  targetRoot?: string;
}): Promise<void> {
  const resolvedSourceModuleDir = args.sourceModuleDir ?? sourceModuleDir;
  const resolvedTargetRoot = args.targetRoot ?? targetRoot;
  const plugins = args.plugins ?? BUNDLED_PLUGINS;
  const build = args.build ?? true;

  await rm(resolvedTargetRoot, { recursive: true, force: true });

  if (plugins.length > 0) {
    await mkdir(resolvedTargetRoot, { recursive: true });
  }

  for (const plugin of plugins) {
    await copyBuiltinPlugin({
      patcherVersion: args.patcherVersion,
      build,
      name: plugin.name,
      sourceRoot: resolveBuiltinPluginRootPathForModuleDir({
        moduleDir: resolvedSourceModuleDir,
        name: plugin.name,
      }),
      targetRoot: resolvedTargetRoot,
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const targetFlagIndex = process.argv.indexOf("--target");
  const targetArg =
    targetFlagIndex !== -1 ? process.argv[targetFlagIndex + 1] : undefined;
  await copyBuiltinPlugins({
    patcherVersion: await readAuthoritativePatcherVersion(),
    ...(targetArg !== undefined ? { targetRoot: path.resolve(targetArg) } : {}),
  });
}
