import { delimiter } from "node:path";
import {
  defaultFeatureFlags,
  hostTypeSchema,
  type HostType,
} from "@patcher/domain";
import { DEFAULTS } from "./defaults.js";
import { defineEnvVar, type EnvVarParseArgs } from "./env.js";
import {
  APP_SURFACE_ENV_NAME,
  DEFAULT_APP_SURFACE,
  formatAppSurfaceValues,
  parseAppSurface,
  type AppSurface,
} from "./app-surface.js";
import {
  validateInferenceFallbackModel,
  validateInferenceModel,
  validateTranscriptionModel,
} from "./inference-model.js";
import { validateLogLevel } from "./log-level.js";
import { validateOptionalUrl, validateRequiredUrl } from "./public-url.js";
import { PATCHER_LOOPBACK_HOST, parsePortValue } from "./runtime.js";

export type ServerBindHost = "127.0.0.1" | "0.0.0.0";

export function parseBooleanEnvValue(args: EnvVarParseArgs): boolean {
  const normalizedValue = args.value.trim().toLowerCase();
  if (
    normalizedValue === "true" ||
    normalizedValue === "1" ||
    normalizedValue === "yes" ||
    normalizedValue === "y"
  ) {
    return true;
  }
  if (
    normalizedValue === "false" ||
    normalizedValue === "0" ||
    normalizedValue === "no" ||
    normalizedValue === "n"
  ) {
    return false;
  }

  throw new Error(`${args.name} must be a boolean`);
}

export function parseAppSurfaceEnvValue(args: EnvVarParseArgs): AppSurface {
  const parsed = parseAppSurface(args.value);
  if (parsed !== undefined) {
    return parsed;
  }
  throw new Error(`${args.name} must be one of ${formatAppSurfaceValues()}`);
}

export function parseOptionalPortEnvValue(
  args: EnvVarParseArgs,
): number | undefined {
  if (args.value === "0") {
    return undefined;
  }

  return parsePortValue({
    name: args.name,
    rawPort: args.value,
  });
}

export function parseOptionalTrimmedStringEnvValue(
  args: EnvVarParseArgs,
): string | undefined {
  const trimmedValue = args.value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}

function parseStringEnvValue(args: EnvVarParseArgs): string {
  return args.value;
}

function parsePathListEnvValue(args: EnvVarParseArgs): string[] {
  return args.value
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseNonEmptyStringEnvValue(args: EnvVarParseArgs): string {
  if (args.value.length === 0) {
    throw new Error(`${args.name} must not be empty`);
  }

  return args.value;
}

function parsePortEnvValue(args: EnvVarParseArgs): number {
  return parsePortValue({
    name: args.name,
    rawPort: args.value,
  });
}

export function parseServerBindHost(value: string): ServerBindHost {
  const trimmedValue = value.trim();
  if (trimmedValue === "127.0.0.1" || trimmedValue === "0.0.0.0") {
    return trimmedValue;
  }

  throw new Error('PATCHER_SERVER_BIND_HOST must be "127.0.0.1" or "0.0.0.0"');
}

function parseServerBindHostEnvValue(args: EnvVarParseArgs): ServerBindHost {
  return parseServerBindHost(args.value);
}

function parsePositiveIntegerEnvValue(args: EnvVarParseArgs): number {
  const parsed = Number(args.value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${args.name} must be a positive integer`);
  }
  return parsed;
}

function parseRequiredUrlEnvValue(args: EnvVarParseArgs): string {
  return validateRequiredUrl(args.name, args.value);
}

function parseOptionalUrlEnvValue(args: EnvVarParseArgs): string {
  return validateOptionalUrl(args.name, args.value);
}

function parseLogLevelValue(args: EnvVarParseArgs): string {
  return validateLogLevel(args.value);
}

function parseInferenceModelValue(args: EnvVarParseArgs): string {
  return validateInferenceModel(args.value);
}

function parseInferenceFallbackModelValue(args: EnvVarParseArgs): string {
  return validateInferenceFallbackModel(args.value);
}

function parseTranscriptionModelValue(args: EnvVarParseArgs): string {
  return validateTranscriptionModel(args.value);
}

function parseHostTypeValue(args: EnvVarParseArgs): HostType | undefined {
  const trimmedValue = args.value.trim();
  if (trimmedValue.length === 0) {
    return undefined;
  }

  const parsedHostType = hostTypeSchema.safeParse(trimmedValue);
  if (!parsedHostType.success) {
    throw new Error(`Invalid ${args.name} "${trimmedValue}"`);
  }

  return parsedHostType.data;
}

export const PATCHER_LOG_LEVEL_ENV = defineEnvVar<string>({
  description: "Log level: trace, debug, info, warn, error, fatal",
  name: "PATCHER_LOG_LEVEL",
  parse: parseLogLevelValue,
});

export const PATCHER_SERVER_PORT_ENV = defineEnvVar<number>({
  description: "HTTP port for the server",
  name: "PATCHER_SERVER_PORT",
  parse: parsePortEnvValue,
});

export const PATCHER_SERVER_BIND_HOST_ENV = defineEnvVar<ServerBindHost>({
  description: "HTTP bind host for the server",
  name: "PATCHER_SERVER_BIND_HOST",
  parse: parseServerBindHostEnvValue,
});

export const PATCHER_HOST_DAEMON_PORT_ENV = defineEnvVar<number>({
  description: "Port the host daemon listens on for local API requests",
  name: "PATCHER_HOST_DAEMON_PORT",
  parse: parsePortEnvValue,
});

export const PATCHER_SERVER_URL_ENV = defineEnvVar<string>({
  description: "URL of the Patcher server",
  name: "PATCHER_SERVER_URL",
  parse: parseRequiredUrlEnvValue,
});

export const PATCHER_APP_VERSION_ENV = defineEnvVar<string>({
  description:
    "Version of the running patcher-app package. The patcher-app launcher sets this from packages/patcher-app/package.json; defaults to a sentinel for dev/source runs.",
  name: "PATCHER_APP_VERSION",
  parse: parseNonEmptyStringEnvValue,
});

export const PATCHER_APP_SURFACE_ENV = defineEnvVar<AppSurface>({
  description:
    "Internal launcher marker for telemetry attribution. Set by patcher-app and desktop launchers.",
  name: APP_SURFACE_ENV_NAME,
  parse: parseAppSurfaceEnvValue,
});

export const PATCHER_APP_URL_ENV = defineEnvVar<string>({
  description:
    "Human-facing app/server base URL used for generated links and allowed browser origins. Does not control which host or port the server binds to.",
  name: "PATCHER_APP_URL",
  parse: parseOptionalUrlEnvValue,
});

export const PATCHER_EXTERNAL_URL_ENV = defineEnvVar<string>({
  description:
    "Internet-facing HTTPS base URL used for generated public links. Does not control which host or port the server binds to.",
  name: "PATCHER_EXTERNAL_URL",
  parse: parseOptionalUrlEnvValue,
});

export const PATCHER_INFERENCE_ENV = defineEnvVar<string>({
  description: "Inference model used for server-side completions",
  name: "PATCHER_INFERENCE",
  parse: parseInferenceModelValue,
});

export const PATCHER_INFERENCE_FALLBACK_ENV = defineEnvVar<string>({
  description:
    "Fallback inference model used after a transient server-side completion failure",
  name: "PATCHER_INFERENCE_FALLBACK",
  parse: parseInferenceFallbackModelValue,
});

export const PATCHER_TRANSCRIPTION_ENV = defineEnvVar<string>({
  description: "Speech-to-text model used for voice transcription",
  name: "PATCHER_TRANSCRIPTION",
  parse: parseTranscriptionModelValue,
});

export const OPENAI_API_KEY_ENV = defineEnvVar<string>({
  description:
    "OpenAI API key used when an explicit OpenAI provider route is configured",
  name: "OPENAI_API_KEY",
  parse: parseStringEnvValue,
});

export const PATCHER_POSTHOG_API_KEY_ENV = defineEnvVar<string>({
  description:
    "PostHog project API key for anonymous usage telemetry. Telemetry is disabled when empty.",
  name: "PATCHER_POSTHOG_API_KEY",
  parse: parseStringEnvValue,
});

export const PATCHER_TELEMETRY_ENV = defineEnvVar<boolean>({
  description:
    "Anonymous usage telemetry (app starts, thread creation counts, and user message counts). Set to false to opt out.",
  name: "PATCHER_TELEMETRY",
  parse: parseBooleanEnvValue,
});

export const PATCHER_PLUGIN_PROCESS_ENV = defineEnvVar<boolean>({
  description:
    "Run installed plugins in a separate plugin host process instead of the server's. Set to false to load every plugin in the server, as releases before this flag did.",
  name: "PATCHER_PLUGIN_PROCESS",
  parse: parseBooleanEnvValue,
});

export const PATCHER_FF_PLACEHOLDER_ENV = defineEnvVar<boolean>({
  description:
    "Permanent placeholder feature flag. Non-functional keep-alive so the flag system has at least one entry; do not gate behavior on it.",
  name: "PATCHER_FF_PLACEHOLDER",
  parse: parseBooleanEnvValue,
});

export const PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET_ENV = defineEnvVar<number>(
  {
    description:
      "Max events one thread-timeline window may span. Raise far above the default to restore unbounded windows.",
    name: "PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET",
    parse: parsePositiveIntegerEnvValue,
  },
);

export const PATCHER_DEV_APP_HOST_ENV = defineEnvVar<string>({
  description:
    "Development-only Vite bind host override for apps/app. Defaults to 127.0.0.1 when unset.",
  name: "PATCHER_DEV_APP_HOST",
  parse: parseStringEnvValue,
});

export const PATCHER_DEV_APP_PORT_ENV = defineEnvVar<number | undefined>({
  description: "Development-only Vite port for apps/app.",
  name: "PATCHER_DEV_APP_PORT",
  parse: parseOptionalPortEnvValue,
});

export const PATCHER_CLI_DIR_ENV = defineEnvVar<string | undefined>({
  description:
    "Directory containing the Patcher CLI executable to inject into runtime shells",
  name: "PATCHER_CLI_DIR",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const PATCHER_CLI_ENV = defineEnvVar<string | undefined>({
  description:
    "Absolute path to the daemon-managed Patcher CLI (injected into agent shells; official entrypoints re-exec here when set)",
  name: "PATCHER_CLI",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const PATCHER_INHERITED_SKILLS_ROOTS_ENV = defineEnvVar<string[]>({
  description:
    "Development-only path list of lower-priority inherited patcher skill roots",
  name: "PATCHER_INHERITED_SKILLS_ROOTS",
  parse: parsePathListEnvValue,
});

export const PATCHER_BRIDGE_DIR_ENV = defineEnvVar<string | undefined>({
  description:
    "Directory containing provider bridge bundles for the host daemon runtime",
  name: "PATCHER_BRIDGE_DIR",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const PATCHER_HOST_ENROLL_KEY_ENV = defineEnvVar<string | undefined>({
  description:
    "One-time enrollment token used to bootstrap a host daemon with the Patcher server",
  name: "PATCHER_HOST_ENROLL_KEY",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const PATCHER_HOST_DAEMON_AUTO_UPDATE_ENV = defineEnvVar<boolean>({
  description:
    "Allow a remote host daemon to install the exact patcher-app package served by its server on a newer protocol mismatch",
  name: "PATCHER_HOST_DAEMON_AUTO_UPDATE",
  parse: parseBooleanEnvValue,
});

export const PATCHER_HOST_ID_ENV = defineEnvVar<string | undefined>({
  description:
    "Preferred host ID to persist for the daemon instead of generating one locally",
  name: "PATCHER_HOST_ID",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const PATCHER_HOST_NAME_ENV = defineEnvVar<string | undefined>({
  description:
    "Preferred host name to report instead of detecting the local hostname",
  name: "PATCHER_HOST_NAME",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const PATCHER_HOST_TYPE_ENV = defineEnvVar<HostType | undefined>({
  description: "Host type override for daemon bootstrap",
  name: "PATCHER_HOST_TYPE",
  parse: parseHostTypeValue,
});

export const DEFAULT_PATCHER_APP_VERSION = DEFAULTS.appVersion;
export const DEFAULT_PATCHER_APP_SURFACE = DEFAULT_APP_SURFACE;
export const DEFAULT_PATCHER_APP_URL = "";
export const DEFAULT_PATCHER_SERVER_BIND_HOST: ServerBindHost =
  PATCHER_LOOPBACK_HOST;
export const DEFAULT_PATCHER_EXTERNAL_URL = "";
export const DEFAULT_OPENAI_API_KEY = "";
// Empty until Patcher has a PostHog project of its own. The key that shipped
// here belonged to bb, and sending this fork's events to it would both pollute
// upstream's data and hand them ours. An empty key disables telemetry outright
// (see telemetry.ts), so production runs send nothing until a Patcher-owned
// write-only key is set here or via PATCHER_POSTHOG_API_KEY.
export const DEFAULT_PATCHER_POSTHOG_API_KEY = "";
export const DEFAULT_PATCHER_TELEMETRY = true;
export const DEFAULT_PATCHER_PLUGIN_PROCESS = true;
export const DEFAULT_PATCHER_DEV_APP_HOST = "";
export const DEFAULT_PATCHER_INFERENCE = DEFAULTS.inferenceModel;
export const DEFAULT_PATCHER_INFERENCE_FALLBACK =
  DEFAULTS.inferenceFallbackModel;
export const DEFAULT_PATCHER_TRANSCRIPTION = DEFAULTS.transcriptionModel;
export const DEFAULT_PATCHER_FF_PLACEHOLDER = defaultFeatureFlags.placeholder;
export const DEFAULT_PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET =
  defaultFeatureFlags.timelineWindowEventBudget;
