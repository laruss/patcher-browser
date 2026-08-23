import {
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
  type EnvVarDefinition,
} from "./env.js";
import {
  PATCHER_HOST_DAEMON_PORT_ENV,
  PATCHER_SERVER_PORT_ENV,
} from "./env-vars.js";
import {
  PATCHER_PROD_HOST_DAEMON_PORT,
  PATCHER_PROD_SERVER_PORT,
  resolveDevInstanceConfig,
} from "./runtime.js";

export interface RuntimePortLoaderArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

export interface RuntimePortDefaultArgs {
  homeDir: string;
  repoRoot?: string;
}

interface LoadRuntimePortValueArgs extends RuntimePortLoaderArgs {
  definition: EnvVarDefinition<number>;
  prodDefault: number;
  devDefault: number | undefined;
}

function resolveDevServerPortDefault(
  args: RuntimePortDefaultArgs,
): number | undefined {
  if (args.repoRoot === undefined) {
    return undefined;
  }

  return resolveDevInstanceConfig({
    homeDir: args.homeDir,
    repoRoot: args.repoRoot,
  }).ports.serverPort;
}

function resolveDevHostDaemonPortDefault(
  args: RuntimePortDefaultArgs,
): number | undefined {
  if (args.repoRoot === undefined) {
    return undefined;
  }

  return resolveDevInstanceConfig({
    homeDir: args.homeDir,
    repoRoot: args.repoRoot,
  }).ports.hostDaemonPort;
}

export function resolveServerPortDefault(
  args: RuntimePortDefaultArgs,
): number | undefined {
  return resolveDevServerPortDefault(args);
}

export function resolveHostDaemonPortDefault(
  args: RuntimePortDefaultArgs,
): number | undefined {
  return resolveDevHostDaemonPortDefault(args);
}

export function loadRuntimePortValue(args: LoadRuntimePortValueArgs): number {
  const loader = resolveEnvLoader(args);
  const configuredPort = readOptionalEnvVar({
    context: loader.context,
    definition: args.definition,
    env: loader.env,
  });
  if (configuredPort !== undefined) {
    return configuredPort;
  }

  if (loader.mode === "prod") {
    return args.prodDefault;
  }

  if (args.devDefault !== undefined) {
    return args.devDefault;
  }

  throw new Error(
    `${args.definition.name} is required unless repoRoot is provided for development`,
  );
}

export function loadServerPortValue(args: RuntimePortLoaderArgs = {}): number {
  const loader = resolveEnvLoader(args);
  return loadRuntimePortValue({
    ...args,
    definition: PATCHER_SERVER_PORT_ENV,
    devDefault: resolveServerPortDefault({
      homeDir: loader.context.homeDir,
      repoRoot: args.repoRoot,
    }),
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    prodDefault: PATCHER_PROD_SERVER_PORT,
  });
}

export function loadHostDaemonPortValue(
  args: RuntimePortLoaderArgs = {},
): number {
  const loader = resolveEnvLoader(args);
  return loadRuntimePortValue({
    ...args,
    definition: PATCHER_HOST_DAEMON_PORT_ENV,
    devDefault: resolveHostDaemonPortDefault({
      homeDir: loader.context.homeDir,
      repoRoot: args.repoRoot,
    }),
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    prodDefault: PATCHER_PROD_HOST_DAEMON_PORT,
  });
}
