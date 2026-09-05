import type { BrowserCommand, BrowserCommandValue } from "@patcher/domain";
import { describe, expect, it } from "vitest";
import { createBrowserBridge } from "../../../src/services/browser/browser-bridge.js";
import {
  browserExternalAccessRefusal,
  currentExternalBrowserCaller,
  runAsExternalBrowserCaller,
} from "../../../src/services/browser/browser-external-access.js";

/**
 * The gate that decides whether a caller from outside Patcher may drive the
 * browser, exercised where it actually decides: the bridge every server-side
 * browser command funnels through.
 *
 * The cases worth having are the two directions of "who is asking". A command
 * with no scope must stay free, because that is the app driving its own browser
 * and a turn's agent tools; a command inside a scope must be charged the level.
 * A gate that got the first wrong would break the browser for everyone, silently
 * and only for the user.
 */

const LIST_TABS: BrowserCommand = { type: "tabs.list" };
const CLICK: BrowserCommand = {
  type: "page.interact",
  tabId: null,
  generation: null,
  interaction: {
    action: "click",
    ref: "e1",
    button: "left",
    clickCount: 1,
    modifiers: [],
  },
};
const READ_COOKIES: BrowserCommand = {
  type: "page.storage",
  tabId: null,
  operation: { kind: "cookies-get" },
};

const TABS_VALUE: BrowserCommandValue = { type: "tabs", tabs: [] };

/** A hub that answers immediately, and counts what it was asked to send. */
function createCountingHub(): {
  hub: Parameters<typeof createBrowserBridge>[0]["hub"];
  sent: () => number;
} {
  let sent = 0;
  return {
    sent: () => sent,
    hub: {
      getBrowserHostSnapshot: () => ({
        connected: true,
        browserHostId: "window-a",
        hostCount: 1,
      }),
      onBrowserHostsChanged: () => () => {},
      requestBrowserCommand: ({ message }) => {
        sent += 1;
        return Promise.resolve({
          type: "browser-command.response" as const,
          requestId: message.requestId,
          outcome: { ok: true as const, value: TABS_VALUE },
        });
      },
    },
  };
}

describe("browser access for callers outside Patcher", () => {
  it("charges nothing when there is no scope", () => {
    // The app, a plugin contribution, a turn's agent tools. None of these is an
    // outside caller and none may be slowed by this.
    expect(browserExternalAccessRefusal(READ_COOKIES)).toBeNull();
    expect(currentExternalBrowserCaller()).toBeUndefined();
  });

  it("refuses everything while the level is off", () => {
    runAsExternalBrowserCaller(
      { level: "off", invocation: "`patcher browser`" },
      () => {
        for (const command of [LIST_TABS, CLICK, READ_COOKIES]) {
          expect(browserExternalAccessRefusal(command)).not.toBeNull();
        }
      },
    );
  });

  it("names the level, the command that changes it and that nothing happened", () => {
    const refusal = runAsExternalBrowserCaller(
      { level: "read", invocation: "`patcher browser`" },
      () => browserExternalAccessRefusal(CLICK),
    );
    expect(refusal).toContain("page.interact");
    // The exact command a person can run, not a gesture at the settings: the
    // reader is usually a model relaying this to somebody else.
    expect(refusal).toContain("patcher settings browser-access interact");
    expect(refusal).toContain("Settings → Browser");
    expect(refusal).toContain("Nothing happened");
  });

  it("admits reading but not acting at the reading level", () => {
    runAsExternalBrowserCaller(
      { level: "read", invocation: "`patcher browser`" },
      () => {
        expect(browserExternalAccessRefusal(LIST_TABS)).toBeNull();
        expect(browserExternalAccessRefusal(CLICK)).not.toBeNull();
        expect(browserExternalAccessRefusal(READ_COOKIES)).not.toBeNull();
      },
    );
  });

  it("admits acting but not the user's logins at the acting level", () => {
    runAsExternalBrowserCaller(
      { level: "interact", invocation: "`patcher browser`" },
      () => {
        expect(browserExternalAccessRefusal(CLICK)).toBeNull();
        expect(browserExternalAccessRefusal(READ_COOKIES)).not.toBeNull();
      },
    );
  });

  it("admits everything at the top level", () => {
    runAsExternalBrowserCaller(
      { level: "full", invocation: "`patcher browser`" },
      () => {
        for (const command of [LIST_TABS, CLICK, READ_COOKIES]) {
          expect(browserExternalAccessRefusal(command)).toBeNull();
        }
      },
    );
  });

  it("survives the awaits between the route and the command", async () => {
    // The whole design rests on this: the route establishes the scope and the
    // browser call happens many awaits later, inside plugin code.
    const seen = await runAsExternalBrowserCaller(
      { level: "read", invocation: "`patcher browser`" },
      async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentExternalBrowserCaller()?.level;
      },
    );
    expect(seen).toBe("read");
    expect(currentExternalBrowserCaller()).toBeUndefined();
  });

  describe("through the bridge", () => {
    it("never sends a refused command to the browser", async () => {
      const { hub, sent } = createCountingHub();
      const bridge = createBrowserBridge({ hub });
      await expect(
        runAsExternalBrowserCaller(
          { level: "read", invocation: "`patcher browser`" },
          () => bridge.call({ command: CLICK }),
        ),
      ).rejects.toMatchObject({
        name: "BrowserCommandError",
        code: "external_access_denied",
      });
      // The point of refusing before the send: "nothing happened" is a claim
      // the message makes, and this is what makes it true.
      expect(sent()).toBe(0);
    });

    it("lets an allowed command through unchanged", async () => {
      const { hub, sent } = createCountingHub();
      const bridge = createBrowserBridge({ hub });
      const value = await runAsExternalBrowserCaller(
        { level: "read", invocation: "`patcher browser`" },
        () => bridge.call({ command: LIST_TABS }),
      );
      expect(value).toEqual(TABS_VALUE);
      expect(sent()).toBe(1);
    });

    it("leaves a caller with no scope alone", async () => {
      const { hub, sent } = createCountingHub();
      const bridge = createBrowserBridge({ hub });
      await bridge.call({ command: READ_COOKIES });
      expect(sent()).toBe(1);
    });
  });
});
