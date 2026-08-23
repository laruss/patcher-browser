/**
 * What a settings *descriptor* is: the schema `patcher.settings.define` is checked
 * against, and nothing else.
 *
 * Split out of plugin-settings.ts for a reason worth stating, because the two
 * halves look like one topic. Reading and writing a plugin's settings needs
 * the database and the secret store; describing them needs neither — and
 * `plugin-api.ts` only ever wanted the describing half. Through that one
 * import, **every plugin process loaded drizzle and better-sqlite3 at
 * startup**, ~60MB of native database machinery for a validator, whether or
 * not the plugin ever touched storage. See
 * apps/server/scripts/measure-plugin-host.mjs.
 */

import { createRequire } from "node:module";
import type { z } from "zod";
import type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
} from "@patcher/plugin-sdk";

export class PluginSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginSettingsValidationError";
  }
}

// Keys become file names (secrets) and CLI arguments; keep them tame.
const SETTING_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Built on the first `patcher.settings.define`, not at import.
 *
 * Same reason as the note above, one layer down: this module is in every plugin
 * process's startup path, and constructing these schemas loads zod — ~9MB
 * resident for a plugin that defines no settings at all. Deferred, zod is a
 * cost only a plugin that actually describes settings pays. `loadZod` in
 * plugin-api.ts explains why it is `require` rather than `await import`.
 */
let descriptorSchemaCache: z.ZodType<PluginSettingDescriptor> | undefined;

function descriptorSchema(): z.ZodType<PluginSettingDescriptor> {
  if (descriptorSchemaCache !== undefined) return descriptorSchemaCache;
  const { z: zod } =
    typeof require === "function"
      ? (require("zod") as typeof import("zod"))
      : (createRequire(import.meta.url)("zod") as typeof import("zod"));
  const baseFields = {
    label: zod.string().min(1),
    description: zod.string().min(1).optional(),
  };
  descriptorSchemaCache = zod.discriminatedUnion("type", [
    zod
      .object({
        type: zod.literal("string"),
        ...baseFields,
        secret: zod.literal(true).optional(),
        default: zod.string().optional(),
      })
      .strict(),
    zod
      .object({
        type: zod.literal("boolean"),
        ...baseFields,
        default: zod.boolean().optional(),
      })
      .strict(),
    zod
      .object({
        type: zod.literal("select"),
        ...baseFields,
        options: zod.array(zod.string().min(1)).min(1),
        default: zod.string().optional(),
      })
      .strict(),
    zod
      .object({
        type: zod.literal("project"),
        ...baseFields,
        default: zod.string().optional(),
      })
      .strict(),
  ]);
  return descriptorSchemaCache;
}

/**
 * Validate freeform descriptors from plugin code (jiti-loaded TS is not
 * typechecked at runtime) and merge them into the plugin's registered schema.
 * Throws a human-readable error for the plugin's load-error status.
 */
export function registerSettingDescriptors(
  target: PluginSettingDescriptors,
  added: Record<string, unknown>,
): PluginSettingDescriptors {
  const validated: PluginSettingDescriptors = {};
  for (const [key, raw] of Object.entries(added)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(
        `invalid setting key "${key}" — use letters, digits, "-" and "_"`,
      );
    }
    if (key in target) {
      throw new Error(`setting "${key}" is already defined`);
    }
    const parsed = descriptorSchema().safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `invalid descriptor for setting "${key}"${path ? ` (${path})` : ""}: ${issue?.message ?? "unknown error"}`,
      );
    }
    const descriptor = parsed.data;
    if (
      descriptor.type === "select" &&
      descriptor.default !== undefined &&
      !descriptor.options.includes(descriptor.default)
    ) {
      throw new Error(
        `default for setting "${key}" must be one of its options`,
      );
    }
    validated[key] = descriptor;
  }
  Object.assign(target, validated);
  return validated;
}
