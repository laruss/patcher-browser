import { AsyncLocalStorage } from "node:async_hooks";
const callers = new AsyncLocalStorage<readonly string[]>();
export function currentPluginSiteCallers(): readonly string[] {
  return callers.getStore() ?? [];
}
export function runWithPluginSiteCallers<T>(
  ids: readonly string[],
  work: () => T,
): T {
  return callers.run(
    [...new Set([...currentPluginSiteCallers(), ...ids])],
    work,
  );
}
