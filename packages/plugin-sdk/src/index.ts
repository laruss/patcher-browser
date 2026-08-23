/**
 * `@patcher/plugin-sdk` — the typed facade plugin authors compile against.
 *
 * The root export carries the side-effect-free app types plus the backend
 * contract (`PatcherPluginApi`, the
 * `server.ts` factory argument — types only, implemented by the Patcher server).
 * The `./app` subpath adds the runtime bindings that `patcher plugin build` shims
 * to the host's shared runtime.
 */
export * from "./app-contract.js";
export * from "./backend-contract.js";
export type * from "./json-value.js";
export * from "./rpc-contract.js";
