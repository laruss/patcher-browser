import type { BrowserAccessGrantRow } from "@patcher/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../src/errors.js";
import {
  BROWSER_ACCESS_REQUEST_DENIAL_COOLDOWN_MS,
  BROWSER_ACCESS_REQUEST_TTL_MS,
  createBrowserAccessRequests,
  MAX_OPEN_BROWSER_ACCESS_REQUESTS,
} from "../../../src/services/browser/browser-access-requests.js";

/**
 * The in-memory half of asking for browser access (#135): the parts that
 * depend on time, which the security tests over HTTP cannot wait for.
 *
 * What these guard is the one state the design exists to avoid — a live grant
 * nobody holds — and the limits that keep a looping agent from filling the
 * person's window.
 */

function createHarness() {
  const grants = new Map<string, BrowserAccessGrantRow>();
  let issued = 0;
  let release: (() => void) | undefined;
  const deps = {
    holdIssue: false,
    issueGrant: vi.fn(async ({ label, level }) => {
      if (deps.holdIssue) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      issued += 1;
      const grant: BrowserAccessGrantRow = {
        id: `bag_${issued}`,
        label,
        level,
        createdAt: Date.now(),
        lastUsedAt: null,
        pausedAt: null,
        revokedAt: null,
      };
      grants.set(grant.id, grant);
      return grant;
    }) as (args: {
      label: string;
      level: BrowserAccessGrantRow["level"];
    }) => Promise<BrowserAccessGrantRow>,
    getGrant: (id: string) => grants.get(id),
    revokeGrant: vi.fn((id: string) => {
      const grant = grants.get(id);
      if (grant !== undefined) grant.revokedAt = Date.now();
    }),
    changed: vi.fn(),
  };
  return {
    deps,
    grants,
    releaseIssue: () => release?.(),
    requests: createBrowserAccessRequests(deps),
  };
}

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ApiError ? error.status : undefined;
  }
  return undefined;
}

describe("browser access requests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes away unanswered, and tells the windows so", () => {
    const { deps, requests } = createHarness();
    const request = requests.create({ label: "Codex", level: "browse" });
    deps.changed.mockClear();

    vi.advanceTimersByTime(BROWSER_ACCESS_REQUEST_TTL_MS);

    expect(requests.list()).toEqual([]);
    expect(deps.changed).toHaveBeenCalledTimes(1);
    expect(statusOf(() => requests.collect(request.id))).toBe(404);
  });

  it("takes back a grant the person allowed and nobody collected", async () => {
    const { deps, grants, requests } = createHarness();
    const request = requests.create({ label: "Codex", level: "browse" });
    await requests.decide(request.id, { decision: "allow" });

    vi.advanceTimersByTime(BROWSER_ACCESS_REQUEST_TTL_MS);

    expect(deps.revokeGrant).toHaveBeenCalledWith("bag_1");
    expect(grants.get("bag_1")?.revokedAt).not.toBeNull();
  });

  it("takes back a grant minted while its request was expiring", async () => {
    const { deps, releaseIssue, requests } = createHarness();
    const request = requests.create({ label: "Codex", level: "browse" });
    deps.holdIssue = true;

    const deciding = requests.decide(request.id, { decision: "allow" });
    vi.advanceTimersByTime(BROWSER_ACCESS_REQUEST_TTL_MS);
    releaseIssue();

    await expect(deciding).rejects.toMatchObject({ status: 404 });
    expect(deps.revokeGrant).toHaveBeenCalledWith("bag_1");
    // Told after the revoke too: the expiry's notice went out before this grant
    // existed, so a grants list read on it would never show the row.
    expect(Math.max(...deps.changed.mock.invocationCallOrder)).toBeGreaterThan(
      deps.revokeGrant.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("hands over nothing for a grant revoked before it was collected", async () => {
    const { deps, requests } = createHarness();
    const request = requests.create({ label: "Codex", level: "browse" });
    await requests.decide(request.id, { decision: "allow" });
    deps.revokeGrant("bag_1");

    expect(statusOf(() => requests.collect(request.id))).toBe(409);
    expect(statusOf(() => requests.collect(request.id))).toBe(404);
  });

  it("answers once: a second Allow on the same request is refused", async () => {
    const { deps, requests } = createHarness();
    const request = requests.create({ label: "Codex", level: "browse" });

    await requests.decide(request.id, { decision: "allow" });

    await expect(
      requests.decide(request.id, { decision: "allow" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(deps.issueGrant).toHaveBeenCalledTimes(1);
  });

  it("caps how many can wait at once", () => {
    const { requests } = createHarness();
    for (let n = 0; n < MAX_OPEN_BROWSER_ACCESS_REQUESTS; n += 1) {
      requests.create({ label: `agent ${n}`, level: "read" });
    }

    expect(
      statusOf(() => requests.create({ label: "one more", level: "read" })),
    ).toBe(429);
  });

  it("counts only what is still in front of the person toward that cap", async () => {
    // Answered but not yet collected is no longer a question: counting those
    // would refuse a new asker while the window shows nothing.
    const { requests } = createHarness();
    for (let n = 0; n < MAX_OPEN_BROWSER_ACCESS_REQUESTS; n += 1) {
      const request = requests.create({ label: `agent ${n}`, level: "read" });
      await requests.decide(request.id, { decision: "allow" });
    }

    expect(requests.list()).toEqual([]);
    expect(
      statusOf(() => requests.create({ label: "one more", level: "read" })),
    ).toBeUndefined();
  });

  it("lets a label that was told no ask again once the cooldown is over", async () => {
    const { requests } = createHarness();
    const request = requests.create({ label: "Codex", level: "browse" });
    await requests.decide(request.id, { decision: "deny" });
    expect(requests.collect(request.id)).toEqual({ outcome: "denied" });

    expect(
      statusOf(() => requests.create({ label: "Codex", level: "browse" })),
    ).toBe(409);
    vi.advanceTimersByTime(BROWSER_ACCESS_REQUEST_DENIAL_COOLDOWN_MS);
    expect(
      statusOf(() => requests.create({ label: "Codex", level: "browse" })),
    ).toBeUndefined();
  });
});
