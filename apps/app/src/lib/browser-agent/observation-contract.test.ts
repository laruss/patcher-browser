import { describe, expect, it } from "vitest";
import { patcherDesktopBrowserObservationSchema } from "@patcher/desktop-contract";
import { browserObservationSchema } from "@patcher/domain";

/**
 * The observation union is written twice for the same reason the interaction
 * union is (see interaction-contract.test.ts): one copy is the agent wire and
 * one is the version-skewed shell wire, and the executor forwards a value parsed
 * by the first straight into the second. A field one accepts and the other
 * rejects parses on the way in and is refused at the last hop, far from the
 * change that caused it. This is the only place both are in scope.
 */

const ACCEPTED: unknown[] = [
  { kind: "pdf" },
  { kind: "console", limit: 1 },
  { kind: "console", limit: 500 },
  { kind: "network", limit: 200 },
];

const REJECTED: unknown[] = [
  {},
  { kind: "console" },
  { kind: "console", limit: 0 },
  // Past the buffer the shell keeps, so asking for it would promise entries
  // that cannot exist.
  { kind: "network", limit: 501 },
  { kind: "video" },
];

/**
 * The screenshot member is the one place the two unions differ on purpose, so
 * it is listed apart from the shared cases: the agent wire carries `fullPage`
 * and the frozen shell wire does not. Everything else about it must still
 * agree.
 */
const SCREENSHOTS = {
  accepted: [
    { format: "png", quality: 1 },
    { format: "jpeg", quality: 100 },
  ],
  rejected: [
    {},
    { format: "webp", quality: 80 },
    { format: "jpeg", quality: 0 },
    { format: "jpeg", quality: 101 },
    { format: "jpeg", quality: 80.5 },
  ],
};

describe("the observation union, on both wires", () => {
  it("accepts the same screenshots either side of the `fullPage` flag", () => {
    for (const value of SCREENSHOTS.accepted) {
      expect(
        browserObservationSchema.safeParse({
          kind: "screenshot",
          ...value,
          fullPage: false,
        }).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        patcherDesktopBrowserObservationSchema.safeParse({ kind: "screenshot", ...value })
          .success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
    for (const value of SCREENSHOTS.rejected) {
      expect(
        browserObservationSchema.safeParse({
          kind: "screenshot",
          ...value,
          fullPage: false,
        }).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(false);
      expect(
        patcherDesktopBrowserObservationSchema.safeParse({ kind: "screenshot", ...value })
          .success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });

  it("requires the agent wire to say which of the two pictures it wants", () => {
    // Not optional-with-a-default: the two captures differ in what they show
    // and in what they cost, so a caller that did not choose has not chosen.
    expect(
      browserObservationSchema.safeParse({
        kind: "screenshot",
        format: "jpeg",
        quality: 80,
      }).success,
    ).toBe(false);
  });

  it("drops `fullPage` on the shell wire rather than refusing it", () => {
    // This is why the executor rebuilds the screenshot observation instead of
    // forwarding it. An older shell does not reject the flag — it strips it and
    // answers with a viewport picture the caller would read as a full page.
    expect(
      patcherDesktopBrowserObservationSchema.parse({
        kind: "screenshot",
        format: "jpeg",
        quality: 80,
        fullPage: true,
      }),
    ).toEqual({ kind: "screenshot", format: "jpeg", quality: 80 });
  });

  it("accepts the same observations", () => {
    for (const value of ACCEPTED) {
      expect(
        browserObservationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        patcherDesktopBrowserObservationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it("rejects the same observations", () => {
    for (const value of REJECTED) {
      expect(
        browserObservationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(false);
      expect(
        patcherDesktopBrowserObservationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });
});
