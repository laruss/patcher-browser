// The subpath, for the reason plugin-api.ts states: every plugin process
// loads this file, and `@patcher/domain`'s index runs every schema in the package.
import {
  canonicalPermissions,
  permissionForRealtimeEvent,
  PLUGIN_SDK_AREA_PERMISSIONS,
  PLUGIN_SDK_METHOD_EXTRA_PERMISSIONS,
  type PluginPermission,
} from "@patcher/domain/plugin-permissions";
import type { PatcherSdk } from "@patcher/sdk";

/**
 * Enforcement for the permissions a plugin declared in `patcher.permissions`.
 *
 * Two chokepoints carry all of it, which is the reason this is worth having:
 * every `patcher.browser.*` call funnels through one `callBrowser`, and every
 * `patcher.sdk` area is handed out by one wrapper. Those two are also exactly the
 * calls that must become RPC when plugins move out of this process, so the
 * gate doubles as the list of what that RPC has to carry.
 *
 * What this is not is a security boundary. A plugin runs in the server's own
 * process; it can reach the loopback API directly with the base URL the host
 * gives it, or skip Patcher entirely and use `node:fs`. See
 * `@patcher/domain`'s plugin-permissions module for the full argument.
 */

export class PluginPermissionError extends Error {
  readonly permission: PluginPermission;
  readonly pluginId: string;

  constructor(pluginId: string, permission: PluginPermission, what: string) {
    super(
      `${what} needs the "${permission}" permission, which plugin "${pluginId}" ` +
        `does not declare. Add it to "patcher.permissions" in the plugin's ` +
        `package.json, then run \`patcher plugin reload ${pluginId}\`.`,
    );
    this.name = "PluginPermissionError";
    this.permission = permission;
    this.pluginId = pluginId;
  }
}

export interface PluginPermissionGate {
  /** Whether the plugin declared this permission. */
  has(permission: PluginPermission): boolean;
  /**
   * Throw {@link PluginPermissionError} unless the plugin declared this.
   * `what` names the call in the plugin's own vocabulary — the message is read
   * by whoever wrote the plugin, including an agent that has to fix it.
   */
  assert(permission: PluginPermission, what: string): void;
  /** The declared set, sorted, for display and for the plugin list. */
  readonly granted: readonly PluginPermission[];
}

export function createPluginPermissionGate(
  pluginId: string,
  declared: readonly PluginPermission[] | undefined,
): PluginPermissionGate {
  const granted = new Set(declared ?? []);
  return {
    granted: canonicalPermissions(declared),
    has(permission) {
      return granted.has(permission);
    },
    assert(permission, what) {
      if (!granted.has(permission)) {
        throw new PluginPermissionError(pluginId, permission, what);
      }
    },
  };
}

/**
 * The area map lives in `@patcher/domain` because the fake plugin host enforces the
 * same one — a second copy is how a plugin's tests start disagreeing with its
 * install. This is where its key set is checked against the type it has to
 * cover, which `@patcher/domain` cannot do without depending on `@patcher/sdk`: a
 * missing area fails to compile here.
 */
const SDK_AREA_PERMISSIONS: Readonly<
  Record<Exclude<keyof PatcherSdk, "subscribe">, PluginPermission>
> = PLUGIN_SDK_AREA_PERMISSIONS;

/**
 * Stand-in for an area the plugin did not ask for. Throws on any property read
 * so `patcher.sdk.terminals` fails where it is reached rather than where it is
 * called — the stack then points at the plugin's own line.
 *
 * The target is a function because one member of `PatcherSdk` is one: `subscribe`
 * is called directly, and a plain object would fail it as "not a function"
 * instead of saying what is missing.
 *
 * Symbols answer `undefined`, so inspecting the object (a `console.log`, a
 * promise checking for `then`) reports rather than explodes.
 */
function deniedSdkArea(
  pluginId: string,
  area: string,
  permission: PluginPermission,
): never {
  const deny = (member: string): never => {
    throw new PluginPermissionError(pluginId, permission, member);
  };
  return new Proxy(function denied() {} as object, {
    apply() {
      return deny(`patcher.sdk.${area}()`);
    },
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      return deny(`patcher.sdk.${area}.${String(property)}`);
    },
  }) as never;
}

/** Replace every `patcher.sdk` area the plugin did not declare. */
export function applySdkPermissions(
  sdk: PatcherSdk,
  pluginId: string,
  gate: PluginPermissionGate,
): PatcherSdk {
  const gated: Record<string, unknown> = { ...sdk };
  for (const [area, permission] of Object.entries(SDK_AREA_PERMISSIONS)) {
    if (!gate.has(permission)) {
      gated[area] = deniedSdkArea(pluginId, area, permission);
    }
  }
  gated.subscribe = ((args: Parameters<PatcherSdk["subscribe"]>[0]) => {
    gate.assert(
      permissionForRealtimeEvent(args.event),
      `patcher.sdk.subscribe({ event: "${args.event}" })`,
    );
    return sdk.subscribe(args);
  }) satisfies PatcherSdk["subscribe"];
  // A few methods cost more than their area, because what they touch straddles
  // two. Charged here as well as on the HTTP path they use, so a plugin cannot
  // pass this gate and then be refused by the other one.
  for (const [member, extra] of Object.entries(
    PLUGIN_SDK_METHOD_EXTRA_PERMISSIONS,
  )) {
    const [area, method] = member.split(".") as [string, string];
    const granted = gated[area];
    // Already denied wholesale: the area proxy refuses the read first.
    if (typeof granted !== "object" || granted === null) continue;
    gated[area] = new Proxy(granted, {
      get(target, property, receiver) {
        if (property !== method) {
          return Reflect.get(target, property, receiver) as unknown;
        }
        return (...args: unknown[]) => {
          for (const permission of extra) {
            gate.assert(permission, `patcher.sdk.${member}`);
          }
          return (
            Reflect.get(target, property, receiver) as (
              ...callArgs: unknown[]
            ) => unknown
          )(...args);
        };
      },
    });
  }
  return gated as unknown as PatcherSdk;
}
