import { resolveEnvLoader, type EnvLoaderArgs } from "./env.js";
import { loadHostDaemonPortValue } from "./ports.js";
import {
  PATCHER_LOOPBACK_HOST,
  PATCHER_PROD_HOST_DAEMON_PORT,
  PATCHER_PROD_SERVER_PORT,
} from "./runtime.js";
import { loadServerUrlValue } from "./server-url.js";

export interface CliConfig {
  PATCHER_HOST_DAEMON_PORT: number;
  PATCHER_SERVER_URL: string;
}

export interface LoadCliConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

const DEFAULT_CLI_SERVER_URL = `http://${PATCHER_LOOPBACK_HOST}:${PATCHER_PROD_SERVER_PORT}`;

function hasConfiguredValue(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] !== undefined;
}

export function loadCliConfig(args: LoadCliConfigArgs = {}): CliConfig {
  const loader = resolveEnvLoader(args);
  const useDevDefaults = loader.mode === "dev" && args.repoRoot !== undefined;
  const serverUrl =
    hasConfiguredValue(loader.env, "PATCHER_SERVER_URL") || useDevDefaults
      ? loadServerUrlValue({
          ...args,
          env: loader.env,
          homeDir: loader.context.homeDir,
          mode: loader.mode,
        })
      : loadServerUrlValue({
          ...args,
          env: loader.env,
          homeDir: loader.context.homeDir,
          mode: loader.mode,
          serverUrl: DEFAULT_CLI_SERVER_URL,
        });

  return {
    PATCHER_HOST_DAEMON_PORT:
      hasConfiguredValue(loader.env, "PATCHER_HOST_DAEMON_PORT") ||
      useDevDefaults
        ? loadHostDaemonPortValue({
            ...args,
            env: loader.env,
            homeDir: loader.context.homeDir,
            mode: loader.mode,
          })
        : PATCHER_PROD_HOST_DAEMON_PORT,
    PATCHER_SERVER_URL: serverUrl,
  };
}
