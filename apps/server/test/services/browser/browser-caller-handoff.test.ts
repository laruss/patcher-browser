import { describe, expect, it } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import {
  rememberBrowserCaller,
  rememberedBrowserCallerCount,
  runAsRememberedBrowserCaller,
} from "../../../src/services/browser/browser-caller-handoff.js";
import { runAsBrowserCommandIssuer } from "../../../src/services/browser/browser-command-issuer.js";
import {
  currentExternalBrowserCaller,
  runAsExternalBrowserCaller,
  type BrowserExternalCallerScope,
} from "../../../src/services/browser/browser-external-access.js";
import { currentBrowserCommandIssuer } from "../../../src/services/browser/browser-command-issuer.js";

/**
 * The caller, carried across the plugin boundary.
 *
 * Two ambient scopes go into a channel message and have to come out the other
 * side of one — and the thing that makes that safe rather than forgeable is
 * that nothing about the caller travels: what travels is an id the host minted
 * for its own call, and the host looks it up in its own record.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_1",
  label: "Claude Code",
  level: "read",
};
const TURN: BrowserCommandIssuer = { kind: "thread", threadId: "thread_1" };
const SCOPE: BrowserExternalCallerScope = {
  level: "read",
  pluginId: "probe",
  grant: { id: "grant_1", label: "Claude Code" },
};

/** What the far side would see, if it asked. */
function observe(): {
  scope: BrowserExternalCallerScope | undefined;
  issuer: BrowserCommandIssuer | undefined;
} {
  return {
    scope: currentExternalBrowserCaller(),
    issuer: currentBrowserCommandIssuer(),
  };
}

describe("carrying a caller across the plugin channel", () => {
  it("gives back both scopes the call was made under", () => {
    const release = runAsExternalBrowserCaller(SCOPE, () =>
      runAsBrowserCommandIssuer(GRANT, () => rememberBrowserCaller("call-1")),
    );

    // The channel message: a fresh async context, where neither scope reaches.
    expect(observe()).toEqual({ scope: undefined, issuer: undefined });
    expect(runAsRememberedBrowserCaller("call-1", observe)).toEqual({
      scope: SCOPE,
      issuer: GRANT,
    });

    release();
  });

  it("carries a turn's name with no level attached", () => {
    // The other half of what this fixes, and the half with no gate in it: a
    // plugin's agent tool inside a turn is charged nothing — its gate is the
    // plugin toggle — but the window still has to be able to say who is
    // driving it.
    const release = runAsBrowserCommandIssuer(TURN, () =>
      rememberBrowserCaller("call-2"),
    );

    expect(runAsRememberedBrowserCaller("call-2", observe)).toEqual({
      scope: undefined,
      issuer: TURN,
    });

    release();
  });

  it("records nothing for a call that is nobody's", () => {
    // Most host→plugin calls: a schedule's tick, a background service, a
    // plugin loading. Recording those would make the map the size of every
    // call rather than of the ones that are somebody's.
    const before = rememberedBrowserCallerCount();

    const release = rememberBrowserCaller("call-3");

    expect(rememberedBrowserCallerCount()).toBe(before);
    expect(runAsRememberedBrowserCaller("call-3", observe)).toEqual({
      scope: undefined,
      issuer: undefined,
    });
    release();
  });

  it("finds nothing for an id it did not issue", () => {
    // An `origin` is untrusted input — the plugin's process chose it. The only
    // thing it can do is name a call the host recorded, so one it did not
    // means what it meant before any of this existed: unattributed.
    expect(runAsRememberedBrowserCaller("call-nobody-minted", observe)).toEqual(
      { scope: undefined, issuer: undefined },
    );
    expect(runAsRememberedBrowserCaller(undefined, observe)).toEqual({
      scope: undefined,
      issuer: undefined,
    });
  });

  it("forgets a call once it has settled", () => {
    // The channel calls the release on every ending a request has, including
    // the plugin process dying under it. Without this the server holds one
    // entry per attributed call it has ever made, for the life of the process.
    const before = rememberedBrowserCallerCount();
    const release = runAsBrowserCommandIssuer(TURN, () =>
      rememberBrowserCaller("call-4"),
    );
    expect(rememberedBrowserCallerCount()).toBe(before + 1);

    release();

    expect(rememberedBrowserCallerCount()).toBe(before);
    expect(runAsRememberedBrowserCaller("call-4", observe)).toEqual({
      scope: undefined,
      issuer: undefined,
    });
  });

  it("keeps two callers of one plugin apart", () => {
    const releaseOutside = runAsExternalBrowserCaller(SCOPE, () =>
      runAsBrowserCommandIssuer(GRANT, () => rememberBrowserCaller("call-5")),
    );
    const releaseTurn = runAsBrowserCommandIssuer(TURN, () =>
      rememberBrowserCaller("call-6"),
    );

    expect(runAsRememberedBrowserCaller("call-5", observe).issuer).toEqual(
      GRANT,
    );
    expect(runAsRememberedBrowserCaller("call-6", observe).issuer).toEqual(TURN);
    // And the level goes with the caller it belongs to, not with the plugin:
    // the turn's call is charged nothing while the grant's is charged "read".
    expect(runAsRememberedBrowserCaller("call-6", observe).scope).toBeUndefined();

    releaseOutside();
    releaseTurn();
  });
});
