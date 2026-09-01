import { z } from "zod";
import { reasoningLevelSchema } from "./shared-types.js";

/**
 * A path that stays under the directory it is joined onto.
 *
 * Both lists below are resolved against a directory the daemon owns — skill
 * roots against the host or the workspace, state directories against `$HOME` —
 * and `path.join` follows an absolute path or a `..` without complaint. For
 * state directories the join decides what an ACP turn's sandbox may write, so
 * this is the boundary rather than a tidiness rule.
 */
function isRelativeSubpath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:\//u.test(normalized) &&
    normalized
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

const providerSkillRootPathSchema = z
  .string()
  .min(1)
  .refine(
    isRelativeSubpath,
    "Skill roots must be relative paths without dot segments",
  );

/**
 * Directories an ACP agent writes its own state into, relative to `$HOME`.
 *
 * What a sandboxed ACP turn grants back to the agent, so that confining it does
 * not stop it from starting. Measured per agent rather than guessed, and the
 * measurements are in `known-acp-agents.ts` beside the agents they belong to.
 *
 * Optional rather than defaulted, because absent and empty are different
 * answers: `[]` says this agent needs nothing under `$HOME`, absent says nobody
 * has looked. `acp/profiles.ts` reads them that way — an undeclared agent runs
 * unconfined with the turn saying so, instead of being confined into failing.
 */
export const acpStateDirsSchema = z.array(
  z
    .string()
    .min(1)
    .refine(
      isRelativeSubpath,
      "State directories must be paths under $HOME, without dot segments",
    ),
);

/**
 * Hostnames an ACP agent needs when its turn's egress is confined.
 *
 * The other half of the same rule as `acpStateDirsSchema`, and read the same
 * way: absent means nobody measured this agent, so its network is left alone
 * rather than confined on a guess; `[]` would mean it needs none. A hostname,
 * never a URL and never a port — `CONNECT` names a host, and that is the unit
 * the boundary can actually decide on. `*.example.com` matches subdomains.
 */
export const acpEgressHostsSchema = z.array(
  z
    .string()
    .min(1)
    .refine(
      (host) => !host.includes("/") && !host.includes(":"),
      "Egress hosts must be hostnames, without a scheme, path, or port",
    ),
);

const uniqueProviderSkillRootPathsSchema = z
  .array(providerSkillRootPathSchema)
  .superRefine((paths, context) => {
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        message: "Skill roots must not contain duplicates",
      });
    }
  });

/** Provider-native skill roots relative to the target host or workspace. */
export const providerNativeSkillRootsSchema = z
  .object({
    user: uniqueProviderSkillRootPathsSchema.default([]),
    project: uniqueProviderSkillRootPathsSchema.default([]),
  })
  .strict();
export type ProviderNativeSkillRoots = z.infer<
  typeof providerNativeSkillRootsSchema
>;

export const acpReasoningCliLevelValueOverridesSchema = z.partialRecord(
  reasoningLevelSchema,
  z.string().min(1),
);

export const acpReasoningCliSchema = z
  .object({
    flag: z.string().min(1),
    supportedLevels: z.array(reasoningLevelSchema).min(1),
    levelValues: acpReasoningCliLevelValueOverridesSchema.optional(),
    defaultLevel: reasoningLevelSchema.optional(),
  })
  .strict()
  .superRefine((reasoningCli, context) => {
    const supportedLevels = new Set(reasoningCli.supportedLevels);
    if (supportedLevels.size !== reasoningCli.supportedLevels.length) {
      context.addIssue({
        code: "custom",
        message: "supportedLevels must not contain duplicates",
        path: ["supportedLevels"],
      });
    }
    if (
      reasoningCli.defaultLevel !== undefined &&
      !supportedLevels.has(reasoningCli.defaultLevel)
    ) {
      context.addIssue({
        code: "custom",
        message: "defaultLevel must be one of supportedLevels",
        path: ["defaultLevel"],
      });
    }
  });
export type AcpReasoningCli = z.infer<typeof acpReasoningCliSchema>;

export const acpNativeReasoningSchema = z
  .object({
    configId: z.string().min(1),
    supportedLevels: z.array(reasoningLevelSchema).min(1),
    levelValues: acpReasoningCliLevelValueOverridesSchema.optional(),
    defaultLevel: reasoningLevelSchema.optional(),
  })
  .strict()
  .superRefine((nativeReasoning, context) => {
    const supportedLevels = new Set(nativeReasoning.supportedLevels);
    if (supportedLevels.size !== nativeReasoning.supportedLevels.length) {
      context.addIssue({
        code: "custom",
        message: "supportedLevels must not contain duplicates",
        path: ["supportedLevels"],
      });
    }
    if (
      nativeReasoning.defaultLevel !== undefined &&
      !supportedLevels.has(nativeReasoning.defaultLevel)
    ) {
      context.addIssue({
        code: "custom",
        message: "defaultLevel must be one of supportedLevels",
        path: ["defaultLevel"],
      });
    }
  });
export type AcpNativeReasoning = z.infer<typeof acpNativeReasoningSchema>;

const acpPermissionCliArgsSchema = z.array(z.string().min(1)).min(1);

export const acpPermissionCliSchema = z
  .object({
    full: acpPermissionCliArgsSchema.optional(),
    workspaceWrite: acpPermissionCliArgsSchema.optional(),
    readonly: acpPermissionCliArgsSchema.optional(),
    insertAfterArgs: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((permissionCli, context) => {
    if (
      permissionCli.full === undefined &&
      permissionCli.workspaceWrite === undefined &&
      permissionCli.readonly === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "permissionCli must configure at least one permission mode",
      });
    }
  });
export type AcpPermissionCli = z.infer<typeof acpPermissionCliSchema>;
