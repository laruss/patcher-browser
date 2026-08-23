import type { HostDaemonEntrypointConfig } from "@patcher/config/host-daemon-entrypoint";

export interface HostDaemonRuntimeEnvironment extends HostDaemonEntrypointConfig {
  PATCHER_DATA_DIR: string;
  PATCHER_HOST_DAEMON_PORT: string;
  PATCHER_SERVER_URL: string;
  NODE_ENV: "development" | "production";
}

export function toHostDaemonProcessEnv(
  environment: HostDaemonRuntimeEnvironment,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      continue;
    }
    // Env values must be strings; booleans serialize to the form
    // parseBooleanEnvValue accepts on the way back in.
    env[key] = typeof value === "boolean" ? (value ? "1" : "0") : value;
  }
  return env;
}
