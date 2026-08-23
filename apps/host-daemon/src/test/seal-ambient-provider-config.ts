/**
 * Unset the provider-config environment variables before any test reads them.
 *
 * Provider discovery deliberately honours the same variables the real CLIs do —
 * `CLAUDE_CONFIG_DIR` points Claude Code's config somewhere other than
 * `~/.claude`, `XDG_CONFIG_HOME` moves opencode's, and so on (see
 * `command-handlers/list-commands.ts`). Every one of them overrides the home
 * directory a caller passes in, which is exactly right in production and
 * exactly wrong here: the discovery tests hand in a temp home and assert what
 * is found under it, so a developer who has one of these set in their shell
 * gets a suite that scans their real machine instead. It fails on skills that
 * belong to whatever is installed there, which is both baffling and
 * unreproducible for anyone else.
 *
 * Deleted rather than blanked. Most readers treat an empty value as absent, but
 * `OMP_PROFILE` is read with an `!== undefined` check that would then shadow
 * `PI_PROFILE`, so "set to nothing" is not the same thing as "not set". Tests
 * that want one of these set their own with `vi.stubEnv`, which is unaffected.
 */
const AMBIENT_PROVIDER_CONFIG_VARIABLES = [
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "GROK_HOME",
  "HERMES_HOME",
  "PI_CODING_AGENT_DIR",
  "PI_CONFIG_FILES",
  "PI_PROFILE",
  "OMP_PROFILE",
] as const;

for (const name of AMBIENT_PROVIDER_CONFIG_VARIABLES) {
  delete process.env[name];
}
