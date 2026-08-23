const LEGACY_PREFIX = "bb.";
const PREFIX = "patcher.";

/**
 * Move browser-stored preferences from their pre-rename key names, once.
 *
 * The clean break covers anything Patcher owns a path to: `~/.bb` is simply not
 * read, and a new install gets a new database. Browser storage is different,
 * because the key is not the whole address — the *origin* is. On the default
 * loopback setup the origin moved with the port (38886 → 38986), so there is
 * genuinely nothing to adopt. On any install reached over a stable non-loopback
 * origin — Tailscale Serve, a fixed reverse proxy, the desktop shell pointed at
 * a custom server URL — the origin did not change at all, and the browser still
 * holds every `bb.*` key while this bundle reads only `patcher.*`.
 *
 * What that abandons is not only cosmetic: the in-app browser's open tabs, which
 * sidebar sections are collapsed, panel widths, and every unsent composer draft.
 * A one-shot rename is not the dual read the plan forbids — nothing keeps
 * reading the old name, and after this runs the old keys are gone.
 *
 * Both stores, because the browser surface deliberately keeps per-tab state in
 * `sessionStorage` (favicons, muted tabs) and the rest in `localStorage`.
 */
export function adoptLegacyBrowserStorage(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  let adopted = 0;
  for (const store of [window.localStorage, window.sessionStorage]) {
    adopted += adoptStore(store);
  }
  return adopted;
}

function adoptStore(store: Storage | undefined): number {
  let adopted = 0;
  // A snapshot: the loop writes and removes, which reindexes the store.
  let legacyKeys: string[];
  try {
    legacyKeys = Object.keys(store ?? {}).filter((key) =>
      key.startsWith(LEGACY_PREFIX),
    );
  } catch {
    // Private windows and "block site data" throw on access, not on read.
    return 0;
  }

  for (const legacyKey of legacyKeys) {
    const key = `${PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`;
    try {
      const legacyValue = store?.getItem(legacyKey) ?? null;
      // Anything already written under the new name was written by a build the
      // user has actually run, so it wins; the legacy copy still goes.
      if (legacyValue !== null && store?.getItem(key) === null) {
        store.setItem(key, legacyValue);
        adopted += 1;
      }
      store?.removeItem(legacyKey);
    } catch {
      // A quota failure on one key must not strand the rest.
    }
  }
  return adopted;
}
