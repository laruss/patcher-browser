import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@patcher/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

/**
 * Hands the app the credential for a machine's own daemon API.
 *
 * The daemon's loopback API has one route that runs something — an `execFile`
 * on the host, outside the sandbox of whatever turn is running — and it used to
 * take the app key. That was the wrong credential twice over: a machine
 * enrolled from another one has no app key file at all, so the app was refused
 * on the very machine it was running on; and the key is a file, so a turn whose
 * provider leaves reads open could read it and present it.
 *
 * So the daemon mints its own, per process, and never writes it down. It
 * arrives with the session (`POST /internal/session/open`), lives in the hub
 * for as long as that session does, and leaves through here — the server the
 * app is already talking to, which is the only party that has it.
 *
 * **Who may read it.** The app, and nothing else. A plugin is refused by the
 * generic gate rather than by anything here: a plugin's reach is a path→
 * permission map, and this path is in it as `null` — classified as never a
 * plugin's to call, at any price, rather than left out and refused by accident.
 * An agent mid-turn is refused by name in `agent-route-policy.ts` — the one read
 * on the whole API a turn may not make, because what it returns is a way out of
 * the turn rather than information about one.
 *
 * A machine with no open daemon session has no credential to give, and that is
 * a 404 rather than an empty answer: the app should say the machine is not
 * connected, not that opening a file failed for no reason.
 */
export function registerHostDaemonKeyRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  get(publicApiRoutes.hostDaemonKeys.get, (context) => {
    const hostId = context.req.param("hostId");
    const key = deps.hub.daemonLocalApiKey(hostId);
    if (key === undefined) {
      throw new ApiError(
        404,
        "host_daemon_key_unavailable",
        "This machine has no daemon session open, so the server has no key for its local API.",
      );
    }
    return context.json({ key });
  });
}
