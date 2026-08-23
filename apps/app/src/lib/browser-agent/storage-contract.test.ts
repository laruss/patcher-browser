import { describe, expect, it } from "vitest";
import { patcherDesktopBrowserStorageOperationSchema } from "@patcher/desktop-contract";
import { browserStorageOperationSchema } from "@patcher/domain";

/**
 * The third union written twice, for the reason the other two are (see
 * interaction-contract.test.ts and observation-contract.test.ts): one copy is
 * the agent wire and one is the version-skewed shell wire, and the executor
 * forwards a value parsed by the first straight into the second.
 */

const COOKIE = {
  name: "session",
  value: "abc",
  domain: ".example.com",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
};

const ACCEPTED: unknown[] = [
  { kind: "cookies-get" },
  { kind: "cookies-set", cookies: [COOKIE] },
  { kind: "cookies-clear", name: null },
  { kind: "cookies-clear", name: "session" },
  { kind: "items-get", area: "local" },
  { kind: "items-get", area: "session" },
  { kind: "items-set", area: "local", items: [{ name: "token", value: "x" }] },
  { kind: "items-clear", area: "session", name: null },
];

const REJECTED: unknown[] = [
  {},
  { kind: "cookies-set", cookies: [] },
  { kind: "cookies-set", cookies: [{ ...COOKIE, sameSite: "lax" }] },
  { kind: "cookies-set", cookies: [{ ...COOKIE, expires: "never" }] },
  // Absent is not the same as null: a caller that forgot the field would
  // otherwise clear every cookie the tab carries.
  { kind: "cookies-clear" },
  { kind: "cookies-clear", name: "" },
  { kind: "items-get" },
  { kind: "items-get", area: "indexeddb" },
  { kind: "items-set", area: "local", items: [] },
  { kind: "items-set", area: "local", items: [{ name: "token" }] },
  { kind: "items-clear", area: "local" },
  { kind: "cookies-flush" },
];

describe("the storage union, on both wires", () => {
  it("accepts the same operations", () => {
    for (const value of ACCEPTED) {
      expect(
        browserStorageOperationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        patcherDesktopBrowserStorageOperationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it("rejects the same operations", () => {
    for (const value of REJECTED) {
      expect(
        browserStorageOperationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(false);
      expect(
        patcherDesktopBrowserStorageOperationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });
});
