import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as commands from "../src/commands.js";
import * as common from "../src/common.js";
import * as session from "../src/session.js";

const { HOST_DAEMON_PROTOCOL_VERSION, hostDaemonCommandRegistry } = commands;

const WIRE_SNAPSHOT_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "wire-snapshots",
);

function hashJsonSchema(schema: z.ZodType): string {
  const shapes = (["input", "output"] as const).map((io) =>
    JSON.stringify(z.toJSONSchema(schema, { io, unrepresentable: "any" })),
  );
  return createHash("sha256").update(shapes.join("\n")).digest("hex");
}

/**
 * One hash per schema that crosses the server ↔ daemon socket or its HTTP
 * routes: every command and its result, and every schema the three wire
 * modules export. Per schema rather than one hash for all, so a failure names
 * what moved.
 *
 * `unrepresentable: "any"` lets refinements and transforms through without a
 * shape, so a change to one of those alone is not caught here.
 */
function fingerprintWire(): Record<string, string> {
  const fingerprints: Record<string, string> = {};
  for (const [type, descriptor] of Object.entries(hostDaemonCommandRegistry)) {
    fingerprints[`command ${type}`] = hashJsonSchema(descriptor.schema);
    fingerprints[`result ${type}`] = hashJsonSchema(descriptor.resultSchema);
  }
  for (const [moduleName, exports] of Object.entries({
    commands,
    common,
    session,
  })) {
    for (const [name, value] of Object.entries(exports)) {
      if (value instanceof z.ZodType) {
        fingerprints[`${moduleName}.${name}`] = hashJsonSchema(value);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(fingerprints).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

describe("host-daemon protocol version", () => {
  // Three bumps from the inherited 106, and only the first changed a message
  // shape.
  //
  // 107 removed the cloud: the `connect-tunnel.ensure-identity` online RPC and
  // the `connect-shares.replace` daemon message are gone, and `session.open`
  // no longer accepts `connectMachineId` or `hasMachineCredential`. A pre-107
  // daemon still sends those fields, which the current schema rejects — the
  // version gate is what stops it reaching payload validation at all.
  //
  // 108 renamed the daemon's environment contract. The daemon builds the agent
  // shell itself: it injects the thread-context variables, strips inherited
  // ones by prefix, and puts the CLI shim on PATH. A pre-rename daemon
  // injects `BB_*` and a `bb` shim, so a thread the server started would run
  // agents that cannot see their own thread id.
  //
  // 109 renamed the WebSocket subprotocol (see session.ts). A 108 daemon would
  // pass the version check and then be refused the socket with a 400 it has no
  // way to read, so the version is what turns that into "Needs update".
  //
  // Nothing on the wire changed for 108 and 109, which is why the version has
  // to say it — enrolled machines must update rather than connect and quietly
  // break.
  //
  // 110 added `/session/env-setup-script-consent`: the daemon asks the server
  // before it runs a repository's own `.patcher-env-setup.sh`. A 109 daemon has
  // no such call, so it would run that script with nobody asked — the version
  // is what stops it opening a session against a server that expects to be
  // asked.
  //
  // 111 added `sandbox` to `terminal.open`: a terminal an agent asked for runs
  // inside the boundary its turn runs in. A 110 daemon ignores the field and
  // would open an unconfined shell for a sandboxed turn — silently, which is
  // the one outcome this whole boundary exists to remove.
  //
  // 112 added `localApiKey` to session open: the daemon's loopback API takes a
  // credential the daemon mints for itself instead of the app key. A 111 daemon
  // sends none, so the server would have nothing to give the app and opening a
  // file in an editor would fail on every machine — the version is what makes
  // the two halves arrive together.
  //
  // 113 added `options.providerNetworkRestricted`: an install can take the
  // network from a sandboxed Codex turn's own commands. A 112 daemon ignores the
  // field and builds the profile with the network open — so the app would say a
  // turn is confined while it is not, which is the silence the bump exists to
  // prevent.
  //
  // 114 added `acpLaunchSpec.stateDirs`: where an ACP agent writes its own
  // state, which is what a sandboxed turn has to grant back so the agent can
  // start. A 113 daemon drops the field, so every launch-spec agent looks
  // unmeasured to it and its sandboxed turns run the provider unconfined — the
  // warning would be accurate about the daemon and wrong about Patcher, which
  // is exactly the silence the field exists to remove.
  //
  // 115 added `acpLaunchSpec.egressHosts` and the two `options.providerEgress*`
  // fields: which hosts an agent needs, and whether this turn is confined to
  // them. A 114 daemon drops all three and leaves the network open, so the app
  // would say a turn's egress is confined while nothing confines it — the same
  // silence as 113, one boundary along.
  //
  // 116 added `/session/egress-host-consent`: the daemon asks before a
  // network-confined turn reaches a host that is on nobody's list, instead of
  // refusing it outright. A 115 server has no such route, so every question a
  // 116 daemon puts would come back as a transport failure and be reported to
  // the agent as "asking you failed" — the version is what makes the two
  // halves of a prompt arrive together.
  //
  // 117 changed what a thread credential *is*. It used to be one bare digest
  // with no deadline in it, good for as long as the app key; it is now two —
  // a turn's, accepted while its thread has a turn running, and a terminal's,
  // accepted while that terminal is open — and each says which it is so the
  // server knows which state decides. A 116 daemon injects the old shape,
  // which a 117 server cannot accept and must not guess at, so every `patcher`
  // call from inside a turn would answer 401. The version is what makes the
  // two halves arrive together.
  //
  // 118 is what lets the server keep the Patcher skills an install put in the
  // global skill roots current (#142) without touching a copy somebody changed:
  // the status read says what this daemon last installed at each path
  // (`installedTreeHash`), an install can be told to replace a copy only while
  // it still hashes to that (`replaceOnlyIfTreeHash`), and says per copy
  // whether it did (`outcome`). A 117 daemon refuses the conditional install as
  // malformed and answers the status read without the field a 118 server needs
  // to tell its own copy from an edited one — so every connect would log a
  // failed read, and nothing would ever be kept current.
  it("uses protocol version 118 after an install learned to replace only its own unchanged copies", () => {
    expect(HOST_DAEMON_PROTOCOL_VERSION).toBe(118);
  });

  // What the version above promises and a build does not check: the wire has
  // not moved since the version was last bumped. A diff that changes a schema
  // fails here; the fix is to bump the version, delete the old snapshot and let
  // vitest write `v<new>.json` (`bun run test -- -u`). Rewriting the snapshot
  // of a version that already shipped is exactly the mistake this exists to
  // make visible — review the diff for a changed hash in a file whose name did
  // not change.
  it("has not changed the wire since the version was bumped", async () => {
    await expect(
      `${JSON.stringify(fingerprintWire(), null, 2)}\n`,
    ).toMatchFileSnapshot(
      path.join(
        WIRE_SNAPSHOT_DIRECTORY,
        `v${HOST_DAEMON_PROTOCOL_VERSION}.json`,
      ),
    );
    // A bump that left the previous version's snapshot behind would leave two
    // files to choose from the next time one is edited by hand.
    expect(readdirSync(WIRE_SNAPSHOT_DIRECTORY)).toEqual([
      `v${HOST_DAEMON_PROTOCOL_VERSION}.json`,
    ]);
  });
});
