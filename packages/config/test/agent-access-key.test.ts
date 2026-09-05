import { describe, expect, it } from "vitest";
import {
  deriveAgentAccessKey,
  parseAgentAccessCredential,
  verifyAgentAccessKey,
} from "../src/agent-access-key.js";

/**
 * What this credential has to be true of, stated as tests rather than as a
 * comment: it names one grant and no other, it is not the app key and cannot be
 * turned back into one, and a caller cannot move it onto a grant with a level
 * they would rather have.
 */

const APP_KEY = "app-key-one-install-0000000000";
const OTHER_APP_KEY = "app-key-other-install-11111111";
const GRANT = "bag_3k9wq2mnpx";
const OTHER_GRANT = "bag_7ytr4hbvcd";

describe("the agent access credential", () => {
  it("is stable for a grant, so nothing has to store it", () => {
    expect(deriveAgentAccessKey({ appApiKey: APP_KEY, grantId: GRANT })).toBe(
      deriveAgentAccessKey({ appApiKey: APP_KEY, grantId: GRANT }),
    );
  });

  it("carries the grant id in the clear, and the id is readable back", () => {
    const key = deriveAgentAccessKey({ appApiKey: APP_KEY, grantId: GRANT });
    expect(key.startsWith(`pa1.${GRANT}.`)).toBe(true);
    expect(parseAgentAccessCredential(key)).toEqual({ grantId: GRANT });
  });

  it("is not the app key, and does not contain it", () => {
    const key = deriveAgentAccessKey({ appApiKey: APP_KEY, grantId: GRANT });
    expect(key).not.toBe(APP_KEY);
    expect(key).not.toContain(APP_KEY);
  });

  it("verifies for its own grant", () => {
    expect(
      verifyAgentAccessKey({
        appApiKey: APP_KEY,
        grantId: GRANT,
        presented: deriveAgentAccessKey({
          appApiKey: APP_KEY,
          grantId: GRANT,
        }),
      }),
    ).toBe(true);
  });

  it("does not verify for another grant", () => {
    // The whole point of the id being inside the MAC as well as beside it: a
    // grant with `read` cannot be presented against the row that says `full`.
    expect(
      verifyAgentAccessKey({
        appApiKey: APP_KEY,
        grantId: OTHER_GRANT,
        presented: deriveAgentAccessKey({
          appApiKey: APP_KEY,
          grantId: GRANT,
        }),
      }),
    ).toBe(false);
  });

  it("does not verify under another install's app key", () => {
    expect(
      verifyAgentAccessKey({
        appApiKey: OTHER_APP_KEY,
        grantId: GRANT,
        presented: deriveAgentAccessKey({
          appApiKey: APP_KEY,
          grantId: GRANT,
        }),
      }),
    ).toBe(false);
  });

  it("refuses a credential whose id was swapped for another", () => {
    // The attack the clear-text id invites: keep the mac, change the id beside
    // it to one with a higher level.
    const key = deriveAgentAccessKey({ appApiKey: APP_KEY, grantId: GRANT });
    const swapped = key.replace(GRANT, OTHER_GRANT);
    expect(parseAgentAccessCredential(swapped)).toEqual({
      grantId: OTHER_GRANT,
    });
    expect(
      verifyAgentAccessKey({
        appApiKey: APP_KEY,
        grantId: OTHER_GRANT,
        presented: swapped,
      }),
    ).toBe(false);
  });

  it("is not a thread credential, and a thread credential is not one", () => {
    // Both are derived from the same app key, so the contexts are what keep
    // them apart. A `pt2.`/`px2.` string must not parse as a grant.
    expect(parseAgentAccessCredential("pt2.abcdef")).toBeUndefined();
    expect(parseAgentAccessCredential("px2.dGVybQ.abcdef")).toBeUndefined();
  });

  it("refuses malformed credentials rather than guessing", () => {
    for (const presented of [
      "",
      "pa1",
      `pa1.${GRANT}`,
      `pa1..mac`,
      `pa1.${GRANT}.`,
      `pa2.${GRANT}.mac`,
      `pa1.${GRANT}.mac.extra`,
      APP_KEY,
    ]) {
      expect(parseAgentAccessCredential(presented)).toBeUndefined();
    }
  });

  it("verifies false for anything malformed rather than throwing", () => {
    for (const presented of ["", "nonsense", `pa1.${GRANT}.wrong-mac`]) {
      expect(
        verifyAgentAccessKey({
          appApiKey: APP_KEY,
          grantId: GRANT,
          presented,
        }),
      ).toBe(false);
    }
  });

  it("refuses to derive from nothing", () => {
    expect(() =>
      deriveAgentAccessKey({ appApiKey: "", grantId: GRANT }),
    ).toThrow(/empty app key/u);
    expect(() =>
      deriveAgentAccessKey({ appApiKey: APP_KEY, grantId: "" }),
    ).toThrow(/without a grant id/u);
  });

  it("refuses a grant id carrying the separator", () => {
    // The id is parsed off the credential by splitting on `.`, so an id with
    // one in it would be ambiguous. Caught where it is minted rather than
    // producing a credential that verifies for a different id than it names.
    expect(() =>
      deriveAgentAccessKey({ appApiKey: APP_KEY, grantId: "bag_a.b" }),
    ).toThrow(/cannot contain/u);
    expect(
      verifyAgentAccessKey({
        appApiKey: APP_KEY,
        grantId: "bag_a.b",
        presented: "pa1.bag_a.b",
      }),
    ).toBe(false);
  });
});
