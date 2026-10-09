import type {
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@patcher/plugin-sdk";
import { setPluginSettingsValues } from "@patcher/db";
import type {
  LoadedPlugin,
  PluginServiceDeps,
  PluginRuntimeStatus,
} from "./plugin-service-internal.js";
import {
  buildPluginSettingsView,
  readPluginSettingsValues,
  writePluginSettingsUpdate,
  validatePluginSettingsUpdate,
  PluginSettingsValidationError,
} from "./plugin-settings.js";

export function createPluginSettingsMethods(args: {
  deps: PluginServiceDeps;
  loaded: Map<string, LoadedPlugin>;
  blockedSettings: Map<string, PluginSettingDescriptors>;
  status: (id: string) => PluginRuntimeStatus | undefined;
  reload: (id: string) => Promise<void>;
  notify: () => void;
  withLock: <T>(run: () => Promise<T>) => Promise<T>;
}) {
  function storeArgs(id: string) {
    const descriptors =
      args.loaded.get(id)?.handle.settings.descriptors ??
      args.blockedSettings.get(id);
    return descriptors === undefined
      ? undefined
      : {
          db: args.deps.db,
          dataDir: args.deps.dataDir,
          pluginId: id,
          descriptors,
          ...(args.deps.secretStore === undefined
            ? {}
            : { secretStore: args.deps.secretStore }),
        };
  }
  return {
    async getSettings(id: string) {
      const store = storeArgs(id);
      return store === undefined ? undefined : buildPluginSettingsView(store);
    },
    async updateSettings(id: string, values: Record<string, unknown>) {
      return args.withLock(async () => {
        const store = storeArgs(id);
        if (store === undefined) return undefined;
        const errors = validatePluginSettingsUpdate(store.descriptors, values);
        if (errors.length > 0)
          throw new PluginSettingsValidationError(errors.join("; "));
        const update = async (
          secretAccess?: import("@patcher/secret-storage").PluginSecretAccess,
        ) => {
          const scoped = {
            ...store,
            ...(secretAccess === undefined ? {} : { secretAccess }),
          };
          const prev = await readPluginSettingsValues(scoped);
          const rows = await writePluginSettingsUpdate({
            ...scoped,
            values,
            deferOrdinaryWrites: true,
          });
          const next = await readPluginSettingsValues(scoped);
          for (const key of Object.keys(rows)) {
            next[key] =
              values[key] === null
                ? store.descriptors[key]?.default
                : (values[key] as PluginSettingValue);
          }
          return { prev, next, rows };
        };
        const commit = (result: { rows: Record<string, string | null> }) => {
          if (Object.keys(result.rows).length > 0)
            setPluginSettingsValues(args.deps.db, id, result.rows);
        };
        const { prev, next } =
          args.deps.secretStore === undefined
            ? await update().then((result) => {
                commit(result);
                return result;
              })
            : await args.deps.secretStore.transaction(id, update, commit);
        if (JSON.stringify(next) !== JSON.stringify(prev)) {
          for (const listener of args.loaded.get(id)?.handle.settings
            .listeners ?? []) {
            try {
              listener(next, prev);
            } catch {
              args.deps.logger.warn(
                `plugin ${id} settings onChange listener failed`,
              );
            }
          }
          args.notify();
          if (args.status(id) === "needs-configuration") {
            await args.reload(id);
            args.notify();
          }
        }
        return buildPluginSettingsView(store);
      });
    },
  };
}
