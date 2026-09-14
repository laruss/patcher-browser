import type { PluginCliCaller } from "@patcher/plugin-sdk";

/**
 * What `patcher browser status` says about the caller's own access.
 *
 * The first question anybody asks this command is "can I act", and until this
 * existed the only way an agent outside Patcher could find out how far it
 * reached was to try something and be refused. That works — the refusal names
 * the level and what the command needed — but it costs a round trip per guess,
 * and a model that has been refused once tends to guess again.
 *
 * Nothing is enforced here. The host has already decided; this is the same
 * decision said out loud, in the words the settings screen uses rather than the
 * enum, because the reader may have to repeat it to a person.
 */

/**
 * Typed by the SDK's own caller rather than by `string`, so a level added to the
 * ramp does not compile here until it has a word. `PluginCliCaller["level"]` is
 * the whole ramp — the SDK exports no level type of its own — and this is the
 * copy `browser-external-access.md` names as the thing that goes stale the day a
 * level is added (#128).
 *
 * Read with a fallback all the same, because the value arrives on the CLI
 * context and not from this module: a raw level is a better answer at somebody's
 * terminal than `undefined`.
 */
const LEVEL_WORDS: Record<PluginCliCaller["level"], string> = {
  off: "nothing — this install does not let agents outside Patcher drive the browser",
  read: "read pages",
  browse: "read pages, and open tabs of your own to read",
  interact: "read pages and act on them",
  full: "everything, including your logins",
};

export function describeBrowserCliCaller(
  caller: PluginCliCaller | undefined,
): string | null {
  // Every caller inside Patcher — a turn, the app, another plugin — and there
  // is nothing to say: their gate is the plugin toggle, which the person who
  // enabled it already read.
  if (caller === undefined) return null;
  const words = LEVEL_WORDS[caller.level] ?? caller.level;
  return caller.kind === "grant"
    ? `Your access: ${words}, through the browser access grant "${caller.label}" (${caller.grantId}).`
    : `Your access: ${words}, from this install's setting for agents outside Patcher.`;
}
