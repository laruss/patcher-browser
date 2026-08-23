import type { HostType } from "@patcher/domain";
import {
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
} from "@patcher/host-daemon-contract";

export type HostDaemonLocalApiMode = "full" | "health-only";

export interface HostDaemonLocalApiConfig {
  bindHost: string;
  healthPath: string;
  healthValue: string;
  mode: HostDaemonLocalApiMode;
  port: number;
}

export interface HostDaemonLocalApiOverrides {
  bindHost?: string;
  healthPath?: string;
  healthValue?: string;
  mode?: HostDaemonLocalApiMode;
  port?: number;
}

export interface ResolveHostDaemonLocalApiConfigArgs {
  hostDaemonPort: number;
  hostType: HostType;
  localApi: HostDaemonLocalApiOverrides | undefined;
}

function getHostDaemonLocalApiDefaults(
  args: ResolveHostDaemonLocalApiConfigArgs,
): HostDaemonLocalApiConfig {
  return {
    bindHost: DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
    healthPath: DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH,
    healthValue: DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
    mode: "full",
    port: args.hostDaemonPort,
  };
}

export function resolveHostDaemonLocalApiConfig(
  args: ResolveHostDaemonLocalApiConfigArgs,
): HostDaemonLocalApiConfig {
  const defaults = getHostDaemonLocalApiDefaults(args);
  return {
    bindHost: args.localApi?.bindHost ?? defaults.bindHost,
    healthPath: args.localApi?.healthPath ?? defaults.healthPath,
    healthValue: args.localApi?.healthValue ?? defaults.healthValue,
    mode: args.localApi?.mode ?? defaults.mode,
    port: args.localApi?.port ?? defaults.port,
  };
}
