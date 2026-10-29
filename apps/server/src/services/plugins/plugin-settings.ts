import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  getPluginSettingsValues,
  setPluginSettingsValues,
  type DbConnection,
} from "@patcher/db";
import type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@patcher/plugin-sdk";
import { deleteSecretFile, writeSecretFile } from "@patcher/secret-storage";
import type {
  PluginSecretAccess,
  PluginSecretStore,
} from "@patcher/secret-storage";

// The descriptor types are part of the backend plugin contract in
// @patcher/plugin-sdk; re-exported so server code keeps one import site. Descriptor
// validation is re-exported too, from the half that does not need a database.
export {
  PluginSettingsValidationError,
  registerSettingDescriptors,
} from "./plugin-setting-descriptors.js";
export type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@patcher/plugin-sdk";

/** A settings update the routes rejected: unknown key or wrong value type. */
export function pluginSecretsDir(dataDir: string, pluginId: string): string {
  return join(dataDir, "plugins", pluginId, "secrets");
}

function secretFilePath(
  dataDir: string,
  pluginId: string,
  key: string,
): string {
  return join(pluginSecretsDir(dataDir, pluginId), key);
}

function isSecret(descriptor: PluginSettingDescriptor): boolean {
  return descriptor.type === "string" && descriptor.secret === true;
}

async function readSecret(
  dataDir: string,
  pluginId: string,
  key: string,
): Promise<string | undefined> {
  try {
    return await readFile(secretFilePath(dataDir, pluginId, key), "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

export interface PluginSettingsStoreArgs {
  db: DbConnection;
  dataDir: string;
  pluginId: string;
  descriptors: PluginSettingDescriptors;
  secretStore?: PluginSecretStore;
  secretAccess?: PluginSecretAccess;
}

function readStoredSettingValue(
  descriptor: PluginSettingDescriptor,
  raw: string | undefined,
): PluginSettingValue | undefined {
  let parsed: unknown;
  if (raw !== undefined) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }
  const expected = descriptor.type === "boolean" ? "boolean" : "string";
  if (typeof parsed !== expected) parsed = undefined;
  if (
    descriptor.type === "select" &&
    typeof parsed === "string" &&
    !descriptor.options.includes(parsed)
  ) {
    parsed = undefined;
  }
  return (parsed as PluginSettingValue | undefined) ?? descriptor.default;
}

/** Effective typed values: stored value when valid, else the default, else undefined. */
export async function readPluginSettingsValues(
  args: PluginSettingsStoreArgs,
): Promise<Record<string, PluginSettingValue | undefined>> {
  const stored = getPluginSettingsValues(args.db, args.pluginId);
  const values: Record<string, PluginSettingValue | undefined> = {};
  for (const [key, descriptor] of Object.entries(args.descriptors)) {
    if (isSecret(descriptor)) {
      const access =
        args.secretAccess ?? args.secretStore?.forPlugin(args.pluginId);
      const value =
        access === undefined
          ? await readSecret(args.dataDir, args.pluginId, key)
          : await access.get(key);
      values[key] = value ?? descriptor.default;
      continue;
    }
    values[key] = readStoredSettingValue(descriptor, stored[key]);
  }
  return values;
}

/**
 * Validate a settings update against the declared descriptors. `null` means
 * "unset". Returns error strings (empty when valid).
 */
export function validatePluginSettingsUpdate(
  descriptors: PluginSettingDescriptors,
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.hasOwn(descriptors, key)
      ? descriptors[key]
      : undefined;
    if (!descriptor) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }
    if (value === null) continue; // unset
    if (descriptor.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`setting "${key}" expects a boolean`);
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (descriptor.type === "select" && !descriptor.options.includes(value)) {
      errors.push(
        `setting "${key}" must be one of: ${descriptor.options.join(", ")}`,
      );
    }
  }
  return errors;
}

/** Persist a pre-validated update: secrets to files, the rest to plugin_settings. */
export async function writePluginSettingsUpdate(
  args: PluginSettingsStoreArgs & {
    values: Record<string, unknown>;
    deferOrdinaryWrites?: boolean;
  },
): Promise<Record<string, string | null>> {
  const access =
    args.secretAccess ?? args.secretStore?.forPlugin(args.pluginId);
  if (
    Object.entries(args.values).some(([key]) => {
      const descriptor = args.descriptors[key];
      return descriptor !== undefined && isSecret(descriptor);
    })
  )
    await access?.assertWritable();
  const rowUpdates: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(args.values)) {
    const descriptor = Object.hasOwn(args.descriptors, key)
      ? args.descriptors[key]
      : undefined;
    if (!descriptor) continue;
    if (isSecret(descriptor)) {
      if (access !== undefined) {
        if (value === null) await access.delete(key);
        else await access.set(key, value as string);
        continue;
      }
      const path = secretFilePath(args.dataDir, args.pluginId, key);
      if (value === null) await deleteSecretFile(path);
      else await writeSecretFile(path, value as string);
      continue;
    }
    rowUpdates[key] = value === null ? null : JSON.stringify(value);
  }
  if (!args.deferOrdinaryWrites && Object.keys(rowUpdates).length > 0) {
    setPluginSettingsValues(args.db, args.pluginId, rowUpdates);
  }
  return rowUpdates;
}

export interface PluginSettingsView {
  schema: PluginSettingDescriptors;
  /** Effective non-secret values; secret keys map to `{ set: boolean }`. */
  values: Record<string, unknown>;
}

export async function buildPluginSettingsView(
  args: PluginSettingsStoreArgs,
): Promise<PluginSettingsView> {
  const stored = getPluginSettingsValues(args.db, args.pluginId);
  const schema: PluginSettingDescriptors = {};
  const values: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(args.descriptors)) {
    const publicDescriptor = { ...descriptor };
    if (isSecret(descriptor)) {
      delete publicDescriptor.default;
      const access =
        args.secretAccess ?? args.secretStore?.forPlugin(args.pluginId);
      if (access !== undefined) {
        values[key] = { set: await access.has(key) };
        schema[key] = publicDescriptor;
        continue;
      }
      try {
        await stat(secretFilePath(args.dataDir, args.pluginId, key));
        values[key] = { set: true };
      } catch (error) {
        const code =
          error instanceof Error && "code" in error ? error.code : undefined;
        if (code !== "ENOENT") throw error;
        values[key] = { set: false };
      }
    } else {
      const effective = readStoredSettingValue(descriptor, stored[key]);
      if (effective !== undefined) values[key] = effective;
    }
    schema[key] = publicDescriptor;
  }
  return { schema, values };
}
