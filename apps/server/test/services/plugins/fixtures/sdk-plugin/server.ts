/**
 * A plugin that reaches for the things a plugin process loads on demand, and
 * only when asked to.
 *
 * Most of what `plugin-api.ts` can pull in is deferred, because a plugin that
 * never touches an area should not pay for it — `@patcher/sdk` alone costs ~100MB
 * resident. So something has to prove that a plugin which *does* touch one
 * still gets a working object, in the form the host actually ships: bundled.
 *
 * `patcher.storage.database()` earns its probe here specifically. Natives stay
 * external to the bundle, and for an external specifier esbuild leaves a
 * `__require` shim that throws in an ES module — so the deferral that works for
 * every bundled package is exactly wrong for this one, and only a test against
 * the real bundle can tell the difference.
 *
 * Reaching for the SDK from a callback rather than the factory is also how a
 * plugin is supposed to use it: `patcher.sdk` is bind-gated until the server is
 * listening.
 */
export default function plugin(patcher: {
  browser: {
    registerContextMenuItem(item: {
      id: string;
      title: string;
      run(context: { selectionText: string | null }): string;
    }): void;
  };
  sdk: { threads: { list(): unknown }; guide: { render(): unknown } };
  storage: { database(): { prepare(sql: string): { get(): unknown } } };
  background: { schedule(name: string, cron: string, fn: () => void): void };
}): void {
  patcher.browser.registerContextMenuItem({
    id: "sdk_probe",
    title: "Probe the SDK",
    // Both halves of the contract the lazy load has to keep: an area method,
    // and `guide.render`, which answers without awaiting anything.
    run: () =>
      `${typeof patcher.sdk.threads.list} ${typeof patcher.sdk.guide.render}`,
  });
  patcher.browser.registerContextMenuItem({
    id: "database_probe",
    title: "Probe the database",
    // The native driver, resolved from disk rather than from the bundle.
    run: () =>
      String(
        (
          patcher.storage.database().prepare("select 1 as one").get() as {
            one: number;
          }
        ).one,
      ),
  });
  // Cron parsing is deferred too, and a bad expression must still be refused
  // at registration — which is what makes the deferral have to be synchronous.
  patcher.background.schedule("nightly", "0 3 * * *", () => {});
}
