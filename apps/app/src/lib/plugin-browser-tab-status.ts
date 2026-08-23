import { useSyncExternalStore } from "react";
import type { PluginBrowserTabStatus } from "@patcher/plugin-sdk";

/**
 * Marks plugins have put on the browser surface's tabs — the tab **decorator**
 * store, written by `contentScript.experimental_setBrowserTabStatus`.
 *
 * Shaped like `plugin-thread-row-status.ts` and for the same reasons, with one
 * difference: the whole map is one snapshot rather than a subscription per key.
 * A window has a handful of tabs in one strip, where the sidebar has hundreds of
 * independent rows, so the cost that per-key subscriptions buy there is not
 * there to buy here.
 *
 * Which plugin owns a mark matters for clearing it: a generation that goes away
 * takes its marks with it, and one plugin cannot clear another's.
 */
type TabStatusListener = () => void;
type TabStatusOwner = string | symbol;

interface TabStatusEntry {
  pluginId: string;
  status: PluginBrowserTabStatus;
}

const entriesByTabId = new Map<string, Map<TabStatusOwner, TabStatusEntry>>();
const listeners = new Set<TabStatusListener>();

/**
 * Rebuilt on every change and handed out unchanged in between, because
 * `useSyncExternalStore` compares snapshots by identity — a fresh map per read
 * would re-render the strip forever.
 */
let snapshot: ReadonlyMap<string, PluginBrowserTabStatus> = new Map();

function buildSnapshot(): ReadonlyMap<string, PluginBrowserTabStatus> {
  const next = new Map<string, PluginBrowserTabStatus>();
  for (const [tabId, owners] of entriesByTabId) {
    // First writer wins, as thread rows do: two plugins marking one tab is a
    // conflict the host resolves by order rather than by drawing both.
    const entry = owners.values().next().value;
    if (entry !== undefined) {
      next.set(tabId, entry.status);
    }
  }
  return next;
}

function publish(): void {
  snapshot = buildSnapshot();
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getPluginBrowserTabStatuses(): ReadonlyMap<
  string,
  PluginBrowserTabStatus
> {
  return snapshot;
}

export function setPluginBrowserTabStatus(
  tabId: string,
  pluginId: string,
  status: PluginBrowserTabStatus | null,
  owner: TabStatusOwner = pluginId,
): void {
  const owners = entriesByTabId.get(tabId);
  if (status === null) {
    if (owners === undefined || !owners.has(owner)) {
      return;
    }
    owners.delete(owner);
    if (owners.size === 0) {
      entriesByTabId.delete(tabId);
    }
  } else if (owners === undefined) {
    entriesByTabId.set(tabId, new Map([[owner, { pluginId, status }]]));
  } else {
    owners.set(owner, { pluginId, status });
  }
  publish();
}

export function clearPluginBrowserTabStatuses(pluginId: string): void {
  let changed = false;
  for (const [tabId, owners] of entriesByTabId) {
    for (const [owner, entry] of owners) {
      if (entry.pluginId === pluginId) {
        owners.delete(owner);
        changed = true;
      }
    }
    if (owners.size === 0) {
      entriesByTabId.delete(tabId);
    }
  }
  if (changed) {
    publish();
  }
}

export function clearPluginBrowserTabStatusesByOwner(
  owner: TabStatusOwner,
): void {
  let changed = false;
  for (const [tabId, owners] of entriesByTabId) {
    if (owners.delete(owner)) {
      changed = true;
    }
    if (owners.size === 0) {
      entriesByTabId.delete(tabId);
    }
  }
  if (changed) {
    publish();
  }
}

/**
 * Drop a closed tab's mark. Tab ids are never reused, so a mark left behind
 * would sit in this map for the life of the window — and reappear on nothing.
 */
export function forgetPluginBrowserTabStatuses(tabId: string): void {
  if (entriesByTabId.delete(tabId)) {
    publish();
  }
}

function subscribe(listener: TabStatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePluginBrowserTabStatuses(): ReadonlyMap<
  string,
  PluginBrowserTabStatus
> {
  return useSyncExternalStore(
    subscribe,
    getPluginBrowserTabStatuses,
    getPluginBrowserTabStatuses,
  );
}

export function resetPluginBrowserTabStatusesForTest(): void {
  entriesByTabId.clear();
  publish();
}
