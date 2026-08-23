import type { HostType } from "@patcher/domain";
import {
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  PATCHER_BRIDGE_DIR_ENV,
  PATCHER_CLI_DIR_ENV,
  PATCHER_HOST_ENROLL_KEY_ENV,
  PATCHER_HOST_DAEMON_AUTO_UPDATE_ENV,
  PATCHER_HOST_ID_ENV,
  PATCHER_HOST_NAME_ENV,
  PATCHER_HOST_TYPE_ENV,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";

export interface HostDaemonEntrypointConfig {
  PATCHER_BRIDGE_DIR?: string;
  PATCHER_CLI_DIR?: string;
  PATCHER_HOST_ENROLL_KEY?: string;
  PATCHER_HOST_DAEMON_AUTO_UPDATE?: boolean;
  PATCHER_HOST_ID?: string;
  PATCHER_HOST_NAME?: string;
  PATCHER_HOST_TYPE?: HostType;
}

export type LoadHostDaemonEntrypointConfigArgs = EnvLoaderArgs;

export function loadHostDaemonEntrypointConfig(
  args: LoadHostDaemonEntrypointConfigArgs = {},
): HostDaemonEntrypointConfig {
  const loader = resolveEnvLoader(args);
  const config: HostDaemonEntrypointConfig = {};
  const bridgeDir = readOptionalEnvVar({
    context: loader.context,
    definition: PATCHER_BRIDGE_DIR_ENV,
    env: loader.env,
  });
  const cliDir = readOptionalEnvVar({
    context: loader.context,
    definition: PATCHER_CLI_DIR_ENV,
    env: loader.env,
  });
  const enrollKey = readOptionalEnvVar({
    context: loader.context,
    definition: PATCHER_HOST_ENROLL_KEY_ENV,
    env: loader.env,
  });
  const autoUpdate = readOptionalEnvVar({
    context: loader.context,
    definition: PATCHER_HOST_DAEMON_AUTO_UPDATE_ENV,
    env: loader.env,
  });
  const hostId = readOptionalEnvVar({
    context: loader.context,
    definition: PATCHER_HOST_ID_ENV,
    env: loader.env,
  });
  const hostName = readOptionalEnvVar({
    context: loader.context,
    definition: PATCHER_HOST_NAME_ENV,
    env: loader.env,
  });
  const hostType = readOptionalEnvVar({
    context: loader.context,
    definition: PATCHER_HOST_TYPE_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "PATCHER_BRIDGE_DIR",
    target: config,
    value: bridgeDir,
  });
  assignIfDefined({
    key: "PATCHER_CLI_DIR",
    target: config,
    value: cliDir,
  });
  assignIfDefined({
    key: "PATCHER_HOST_DAEMON_AUTO_UPDATE",
    target: config,
    value: autoUpdate,
  });
  assignIfDefined({
    key: "PATCHER_HOST_ENROLL_KEY",
    target: config,
    value: enrollKey,
  });
  assignIfDefined({
    key: "PATCHER_HOST_ID",
    target: config,
    value: hostId,
  });
  assignIfDefined({
    key: "PATCHER_HOST_NAME",
    target: config,
    value: hostName,
  });
  assignIfDefined({
    key: "PATCHER_HOST_TYPE",
    target: config,
    value: hostType,
  });

  return config;
}
