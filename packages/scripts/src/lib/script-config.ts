import {
  resolveRuntimeMode,
  type PatcherRuntimeMode,
} from "@patcher/config/runtime";

// Matches @patcher/config runtime mode resolution: anything other than "production"
// is treated as dev. Keeping scripts and runtime config in sync is
// load-bearing because they derive the same data dir, ports, and server URL.
export function resolveScriptMode(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): PatcherRuntimeMode {
  return resolveRuntimeMode(nodeEnv);
}

export function resolveNodeEnvironment(
  mode: PatcherRuntimeMode,
): "development" | "production" {
  return mode === "dev" ? "development" : "production";
}
