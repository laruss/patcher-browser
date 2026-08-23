import { join } from "node:path";
import {
  agentProviderIdSchema,
  isAgentProviderId,
} from "@patcher/agent-providers";
import {
  acpNativeReasoningSchema,
  acpReasoningCliSchema,
  providerNativeSkillRootsSchema,
} from "@patcher/domain";
import { z } from "zod";

export const PATCHER_APP_CONFIG_FILE_NAME = "config.json";
export const PATCHER_APP_ENV_FILE_NAME = "env.json";

export type PatcherAppManagedConfigKey =
  | "PATCHER_APP_URL"
  | "PATCHER_INFERENCE"
  | "PATCHER_INFERENCE_FALLBACK"
  | "PATCHER_LOG_LEVEL"
  | "PATCHER_TRANSCRIPTION";

export const PATCHER_APP_MANAGED_CONFIG_KEYS: PatcherAppManagedConfigKey[] = [
  "PATCHER_APP_URL",
  "PATCHER_INFERENCE",
  "PATCHER_INFERENCE_FALLBACK",
  "PATCHER_LOG_LEVEL",
  "PATCHER_TRANSCRIPTION",
];

export const PORTABLE_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const CUSTOM_ACP_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const CUSTOM_ACP_AGENT_LOGO_PATTERN = /\.(?:svg|png|webp)$/iu;

export interface PatcherAppManagedConfigWarningLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface ParsePatcherAppManagedConfigOptions {
  logger?: PatcherAppManagedConfigWarningLogger;
}

export const patcherAppManagedConfigValuesSchema = z
  .object({
    PATCHER_APP_URL: z.string().optional(),
    PATCHER_INFERENCE: z.string().optional(),
    PATCHER_INFERENCE_FALLBACK: z.string().optional(),
    PATCHER_LOG_LEVEL: z.string().optional(),
    PATCHER_TRANSCRIPTION: z.string().optional(),
  })
  .strict();

// ACP provider ids are dynamic: known agents (acp-opencode, acp-omp, …) and
// custom agents (acp-<slug>) both live outside the built-in provider enum, so
// customModels accepts any well-formed acp-* id alongside the enum.
const ACP_PROVIDER_ID_PATTERN = /^acp-[a-z0-9][a-z0-9-]*$/u;

const customModelProviderIdSchema = z.union([
  agentProviderIdSchema,
  z.string().regex(ACP_PROVIDER_ID_PATTERN),
]);

// A user-registered model offered in the model picker in addition to the
// provider's built-in catalog (e.g. a non-public preview model id). Omitting
// `displayName` means "derive the label from the model id".
export const customProviderModelSchema = z
  .object({
    providerId: customModelProviderIdSchema,
    model: z.string().min(1),
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const patcherAppManagedEnvNameSchema = z
  .string()
  .regex(PORTABLE_ENV_NAME_PATTERN);

export const patcherAppManagedEnvConfigSchema = z.record(
  patcherAppManagedEnvNameSchema,
  z.string(),
);

export function formatCustomAcpAgentProviderId(id: string): string {
  return `acp-${id}`;
}

const customAcpAgentModelCliSchema = z
  .object({
    listArgs: z.array(z.string()).default([]),
    selectFlag: z.string().min(1).optional(),
    primaryModels: z.array(z.string()).default([]),
  })
  .strict()
  .transform((modelCli) =>
    modelCli.listArgs.length > 0 ? modelCli : undefined,
  );

// One user-registered ACP agent. `id` is a slug; Patcher derives the runtime
// provider id as `acp-<id>`.
export const customAcpAgentSchema = z
  .object({
    id: z.string().regex(CUSTOM_ACP_AGENT_ID_PATTERN),
    displayName: z.string().min(1),
    command: z.string().min(1),
    logo: z
      .string()
      .min(1)
      .regex(
        CUSTOM_ACP_AGENT_LOGO_PATTERN,
        "Custom ACP agent logo must be an .svg, .png, or .webp file.",
      )
      .optional(),
    args: z.array(z.string()).default([]),
    env: z.record(patcherAppManagedEnvNameSchema, z.string()).default({}),
    cwd: z.string().min(1).optional(),
    modelCli: customAcpAgentModelCliSchema.optional(),
    reasoningCli: acpReasoningCliSchema.optional(),
    nativeReasoning: acpNativeReasoningSchema.optional(),
    nativeSkillRoots: providerNativeSkillRootsSchema.optional(),
  })
  .strict()
  .superRefine((agent, context) => {
    const providerId = formatCustomAcpAgentProviderId(agent.id);
    if (isAgentProviderId(providerId)) {
      context.addIssue({
        code: "custom",
        message: `Custom ACP agent id "${agent.id}" resolves to built-in provider "${providerId}".`,
        path: ["id"],
      });
    }
  })
  .transform(({ modelCli, ...agent }) => {
    return modelCli === undefined ? agent : { ...agent, modelCli };
  });

const customAcpAgentsSchema = z
  .array(customAcpAgentSchema)
  .superRefine((agents, context) => {
    const seenProviderIds = new Set<string>();
    for (const [index, agent] of agents.entries()) {
      const providerId = formatCustomAcpAgentProviderId(agent.id);
      if (seenProviderIds.has(providerId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate custom ACP agent provider id "${providerId}".`,
          path: [index, "id"],
        });
      }
      seenProviderIds.add(providerId);
    }
  });

export const patcherAppManagedConfigSchema = z
  .object({
    config: patcherAppManagedConfigValuesSchema.optional(),
    customAcpAgents: customAcpAgentsSchema.optional(),
    customModels: z.array(customProviderModelSchema).optional(),
    sharedSkillRoots: providerNativeSkillRootsSchema.optional(),
    serverUrl: z.string().min(1).optional(),
  })
  .strict();

const patcherAppManagedConfigBoundarySchema = z
  .object({
    config: patcherAppManagedConfigValuesSchema.optional(),
    customAcpAgents: z.array(z.unknown()).optional(),
    customModels: z.array(z.unknown()).optional(),
    sharedSkillRoots: providerNativeSkillRootsSchema.optional(),
    serverUrl: z.string().min(1).optional(),
  })
  .strict();

export const patcherAppManagedEnvFileSchema = z
  .object({
    env: patcherAppManagedEnvConfigSchema.optional(),
  })
  .strict();

export type PatcherAppManagedConfigValues = z.infer<
  typeof patcherAppManagedConfigValuesSchema
>;
export type CustomAcpAgent = z.infer<typeof customAcpAgentSchema>;
export type CustomProviderModel = z.infer<typeof customProviderModelSchema>;
export type PatcherAppManagedConfig = z.infer<
  typeof patcherAppManagedConfigSchema
>;
export type PatcherAppManagedEnvConfig = z.infer<
  typeof patcherAppManagedEnvConfigSchema
>;
export type PatcherAppManagedEnvFile = z.infer<
  typeof patcherAppManagedEnvFileSchema
>;

function warnInvalidCustomAcpAgent(
  logger: PatcherAppManagedConfigWarningLogger | undefined,
  fields: Record<string, unknown>,
): void {
  logger?.warn(fields, "Ignoring invalid custom ACP agent config entry");
}

function parseCustomAcpAgents(
  entries: readonly unknown[] | undefined,
  options: ParsePatcherAppManagedConfigOptions,
): CustomAcpAgent[] | undefined {
  if (entries === undefined) {
    return undefined;
  }

  const agents: CustomAcpAgent[] = [];
  const seenProviderIds = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const result = customAcpAgentSchema.safeParse(entry);
    if (!result.success) {
      warnInvalidCustomAcpAgent(options.logger, {
        error: result.error.message,
        index,
      });
      continue;
    }

    const providerId = formatCustomAcpAgentProviderId(result.data.id);
    if (seenProviderIds.has(providerId)) {
      warnInvalidCustomAcpAgent(options.logger, {
        error: `Duplicate custom ACP agent provider id "${providerId}".`,
        index,
        providerId,
      });
      continue;
    }

    seenProviderIds.add(providerId);
    agents.push(result.data);
  }

  return agents;
}

function parseCustomModels(
  entries: readonly unknown[] | undefined,
  options: ParsePatcherAppManagedConfigOptions,
): CustomProviderModel[] | undefined {
  if (entries === undefined) {
    return undefined;
  }

  const customModels: CustomProviderModel[] = [];
  for (const [index, entry] of entries.entries()) {
    const result = customProviderModelSchema.safeParse(entry);
    if (!result.success) {
      options.logger?.warn(
        { error: result.error.message, index },
        "Ignoring invalid custom model config entry",
      );
      continue;
    }
    customModels.push(result.data);
  }

  return customModels;
}

export function parsePatcherAppManagedConfig(
  rawConfig: unknown,
  options: ParsePatcherAppManagedConfigOptions = {},
): PatcherAppManagedConfig {
  const parsed = patcherAppManagedConfigBoundarySchema.parse(rawConfig);
  const customAcpAgents = parseCustomAcpAgents(parsed.customAcpAgents, options);
  const customModels = parseCustomModels(parsed.customModels, options);
  const config: PatcherAppManagedConfig = {};
  if (parsed.config !== undefined) {
    config.config = parsed.config;
  }
  if (customAcpAgents !== undefined) {
    config.customAcpAgents = customAcpAgents;
  }
  if (customModels !== undefined) {
    config.customModels = customModels;
  }
  if (parsed.sharedSkillRoots !== undefined) {
    config.sharedSkillRoots = parsed.sharedSkillRoots;
  }
  if (parsed.serverUrl !== undefined) {
    config.serverUrl = parsed.serverUrl;
  }
  return config;
}

export function formatPatcherAppConfigPath(dataDir: string): string {
  return join(dataDir, PATCHER_APP_CONFIG_FILE_NAME);
}

export function formatPatcherAppEnvPath(dataDir: string): string {
  return join(dataDir, PATCHER_APP_ENV_FILE_NAME);
}
