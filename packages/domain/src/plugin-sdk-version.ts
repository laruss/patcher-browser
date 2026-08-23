/**
 * Version of the Patcher plugin SDK surface (`@patcher/plugin-sdk`). Single source of
 * truth shared by the CLI and the server: `patcher plugin build` stamps it into a
 * plugin's `dist/app.meta.json` sidecar, and the host compares majors before
 * loading a bundle (design §7 — a stale bundle is skipped legibly, never a
 * TypeError).
 */
// 1.0.0 is the Patcher rename itself: the manifest key, the contribution ids
// and the SDK specifier all changed at once, so no bundle built against an
// earlier SDK can load. From here the major carries breaking changes and the
// artifact gate stops being vacuous — a bundle stamped with a different major
// is skipped legibly, instead of falling back on the pre-1.0 rule that
// compared sdkVersion exactly.
export const PLUGIN_SDK_VERSION = "1.0.0";

/** Major of {@link PLUGIN_SDK_VERSION} — the plugin API compatibility number. */
export const PLUGIN_SDK_MAJOR = Number(PLUGIN_SDK_VERSION.split(".", 1)[0]);
