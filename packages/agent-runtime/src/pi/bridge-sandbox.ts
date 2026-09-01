/**
 * What confining a Pi turn means, and what the confinement has to grant back.
 *
 * Pi has no permission system of its own. Its documentation says so in as many
 * words — "Pi does not include a built-in permission system for restricting
 * filesystem, process, network, or credential access … If you need stronger
 * boundaries, containerize or sandbox Pi" — so there is no hook to check a path
 * in, the way Patcher's ACP bridge checks `fs/write_text_file`. The only
 * boundary available is an OS sandbox around the process running the session.
 *
 * That process is this bridge, and the difference from ACP is the whole reason
 * this module exists: an ACP agent is a *child* of its bridge, so confining the
 * child is enough, while Pi's tools run inside the bridge itself — its edit
 * tools are `fs` calls on the same process that speaks to the daemon. Measured
 * under the sandbox the daemon builds: an in-process write inside the workspace
 * succeeds, an in-process write to `$HOME` is `EPERM`, and a child of the same
 * process is refused the same path — so confining the bridge holds Pi's own
 * tools and its bash tool alike.
 *
 * Which makes the bridge's own writes the thing that has to be granted back,
 * measured one directory at a time the way an ACP agent's are.
 */

/** The one provider whose own bridge process a sandboxed turn confines. */
export const PI_PROVIDER_ID = "pi";

export const PI_BRIDGE_STATE_DIRS: readonly string[] = [
  /**
   * Pi's own directory.
   *
   * Confined with nothing granted, a Pi session still starts — and that is the
   * trap rather than a licence to grant nothing. Pi takes a lock beside each
   * file it reads there: watching the directory during an unconfined start
   * shows `auth.json.lock` and `models-store.json.lock` appear and disappear,
   * and confined without this grant neither is ever created and nothing is
   * reported. The files under those locks are the ones an OAuth login refreshes
   * (Pi stores subscription tokens in `auth.json` and refreshes them itself),
   * so a turn denied the lock would fail when a token expires rather than at a
   * point anyone would connect to the sandbox.
   *
   * Granted at `.pi` rather than at the `.pi/agent` the measurement named: a
   * superset cannot break what was measured, and Pi resolving its agent
   * directory somewhere else under its own root is Pi's business rather than a
   * turn that stops working.
   */
  ".pi",
  /**
   * The thread history this bridge appends — Patcher's own state, not Pi's:
   * `resolvePiSessionFilePath` resolves it from `$HOME` in this process rather
   * than from the daemon's data directory. Measured in-process: an append here
   * under the sandbox is `EPERM` without the grant.
   *
   * It holds every Pi thread on the machine, so a confined turn can write over
   * another Pi thread's stored history. Reads were never restricted, and the
   * alternative — a per-thread directory — would move where an existing thread's
   * history lives. `docs/security.md` names it rather than pretending
   * otherwise.
   */
  ".patcher/pi-bridge-sessions",
];
