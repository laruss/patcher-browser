import { loadServerPortValue, type RuntimePortLoaderArgs } from "./ports.js";

export interface ServerPortConfig {
  PATCHER_SERVER_PORT: number;
}

export type LoadServerPortConfigArgs = RuntimePortLoaderArgs;

export function loadServerPortConfig(
  args: LoadServerPortConfigArgs = {},
): ServerPortConfig {
  return {
    PATCHER_SERVER_PORT: loadServerPortValue(args),
  };
}
