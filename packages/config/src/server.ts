import type { FeatureFlags } from "@patcher/domain";
import type { AppSurface } from "./app-surface.js";
import {
  loadCommonConfig,
  type CommonConfig,
  type LoadCommonConfigArgs,
} from "./common.js";
import { loadDatabaseConfig, type DatabaseConfig } from "./database.js";
import { loadDevAppConfig } from "./dev-app.js";
import { readEnvVarWithDefault, resolveEnvLoader } from "./env.js";
import {
  PATCHER_APP_URL_ENV,
  PATCHER_APP_SURFACE_ENV,
  PATCHER_APP_VERSION_ENV,
  PATCHER_EXTERNAL_URL_ENV,
  PATCHER_INHERITED_SKILLS_ROOTS_ENV,
  PATCHER_INFERENCE_FALLBACK_ENV,
  PATCHER_INFERENCE_ENV,
  PATCHER_PLUGIN_PROCESS_ENV,
  PATCHER_POSTHOG_API_KEY_ENV,
  PATCHER_SERVER_BIND_HOST_ENV,
  PATCHER_TELEMETRY_ENV,
  PATCHER_TRANSCRIPTION_ENV,
  DEFAULT_PATCHER_APP_URL,
  DEFAULT_PATCHER_APP_SURFACE,
  DEFAULT_PATCHER_APP_VERSION,
  DEFAULT_PATCHER_EXTERNAL_URL,
  DEFAULT_PATCHER_INFERENCE_FALLBACK,
  DEFAULT_PATCHER_INFERENCE,
  DEFAULT_PATCHER_PLUGIN_PROCESS,
  DEFAULT_PATCHER_POSTHOG_API_KEY,
  DEFAULT_PATCHER_SERVER_BIND_HOST,
  DEFAULT_PATCHER_TELEMETRY,
  DEFAULT_PATCHER_TRANSCRIPTION,
  DEFAULT_OPENAI_API_KEY,
  OPENAI_API_KEY_ENV,
  parseServerBindHost,
  type ServerBindHost,
} from "./env-vars.js";
import { loadFeatureFlags } from "./feature-flags.js";
import { assignIfDefined } from "./objects.js";
import { loadHostDaemonPortValue } from "./ports.js";
import { loadServerPortConfig, type ServerPortConfig } from "./server-port.js";

export interface ServerConfig
  extends CommonConfig, DatabaseConfig, ServerPortConfig {
  PATCHER_APP_URL: string;
  PATCHER_APP_SURFACE: AppSurface;
  PATCHER_APP_VERSION: string;
  PATCHER_DEV_APP_PORT?: number;
  PATCHER_EXTERNAL_URL: string;
  PATCHER_HOST_DAEMON_PORT: number;
  PATCHER_INHERITED_SKILLS_ROOTS: string[];
  PATCHER_INFERENCE: string;
  PATCHER_INFERENCE_FALLBACK: string;
  PATCHER_PLUGIN_PROCESS: boolean;
  PATCHER_POSTHOG_API_KEY: string;
  PATCHER_SERVER_BIND_HOST: ServerBindHost;
  PATCHER_TELEMETRY: boolean;
  PATCHER_TRANSCRIPTION: string;
  OPENAI_API_KEY: string;
  featureFlags: FeatureFlags;
}

export type LoadServerConfigArgs = LoadCommonConfigArgs;

export { parseServerBindHost };
export type { ServerBindHost };

export function loadServerConfig(
  args: LoadServerConfigArgs = {},
): ServerConfig {
  const loader = resolveEnvLoader(args);
  const commonConfig = loadCommonConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const databaseConfig = loadDatabaseConfig({
    commonConfig,
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const serverPortConfig = loadServerPortConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const devAppConfig = loadDevAppConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
  });
  const config: ServerConfig = {
    ...commonConfig,
    ...databaseConfig,
    ...serverPortConfig,
    PATCHER_APP_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_APP_URL,
      definition: PATCHER_APP_URL_ENV,
      env: loader.env,
    }),
    PATCHER_APP_SURFACE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_APP_SURFACE,
      definition: PATCHER_APP_SURFACE_ENV,
      env: loader.env,
    }),
    PATCHER_APP_VERSION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_APP_VERSION,
      definition: PATCHER_APP_VERSION_ENV,
      env: loader.env,
    }),
    PATCHER_EXTERNAL_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_EXTERNAL_URL,
      definition: PATCHER_EXTERNAL_URL_ENV,
      env: loader.env,
    }),
    PATCHER_HOST_DAEMON_PORT: loadHostDaemonPortValue({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
      repoRoot: args.repoRoot,
    }),
    PATCHER_INHERITED_SKILLS_ROOTS: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: [],
      definition: PATCHER_INHERITED_SKILLS_ROOTS_ENV,
      env: loader.env,
    }),
    PATCHER_INFERENCE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_INFERENCE,
      definition: PATCHER_INFERENCE_ENV,
      env: loader.env,
    }),
    PATCHER_INFERENCE_FALLBACK: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_INFERENCE_FALLBACK,
      definition: PATCHER_INFERENCE_FALLBACK_ENV,
      env: loader.env,
    }),
    PATCHER_PLUGIN_PROCESS: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_PLUGIN_PROCESS,
      definition: PATCHER_PLUGIN_PROCESS_ENV,
      env: loader.env,
    }),
    PATCHER_POSTHOG_API_KEY: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_POSTHOG_API_KEY,
      definition: PATCHER_POSTHOG_API_KEY_ENV,
      env: loader.env,
    }),
    PATCHER_SERVER_BIND_HOST: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_SERVER_BIND_HOST,
      definition: PATCHER_SERVER_BIND_HOST_ENV,
      env: loader.env,
    }),
    PATCHER_TELEMETRY: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_TELEMETRY,
      definition: PATCHER_TELEMETRY_ENV,
      env: loader.env,
    }),
    PATCHER_TRANSCRIPTION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_TRANSCRIPTION,
      definition: PATCHER_TRANSCRIPTION_ENV,
      env: loader.env,
    }),
    OPENAI_API_KEY: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_OPENAI_API_KEY,
      definition: OPENAI_API_KEY_ENV,
      env: loader.env,
    }),
    featureFlags: loadFeatureFlags({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
  };

  assignIfDefined({
    key: "PATCHER_DEV_APP_PORT",
    target: config,
    value: devAppConfig.PATCHER_DEV_APP_PORT,
  });

  return config;
}
