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

const LEVEL_WORDS: Record<string, string> = {
  off: "nothing — this install does not let agents outside Patcher drive the browser",
  read: "read pages",
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
