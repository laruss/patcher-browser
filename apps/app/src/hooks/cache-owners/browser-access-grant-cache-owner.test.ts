import { describe, expect, it } from "vitest";
import type { SystemBrowserAccessRequest } from "@patcher/server-contract";
import { createAppQueryClient } from "@/lib/query-client";
import {
  browserAccessGrantsQueryKey,
  browserAccessRequestsQueryKey,
} from "../queries/query-keys";
import { reconcileAnsweredBrowserAccessRequest } from "./browser-access-grant-cache-owner";

function request(id: string): SystemBrowserAccessRequest {
  return {
    id,
    label: id,
    level: "read",
    reason: null,
    createdAt: 0,
    expiresAt: 600_000,
  };
}

describe("answering a browser access request", () => {
  it("drops the answered row from what is cached now, not from the reply, and re-reads both lists", () => {
    // The cached list may already be newer than the reply: another window's
    // ask arrived by `config-changed` while this answer was in the air.
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(browserAccessRequestsQueryKey(), {
      requests: [request("bar_answered"), request("bar_newer")],
    });
    queryClient.setQueryData(browserAccessGrantsQueryKey(), { grants: [] });

    reconcileAnsweredBrowserAccessRequest({
      queryClient,
      requestId: "bar_answered",
    });

    expect(queryClient.getQueryData(browserAccessRequestsQueryKey())).toEqual({
      requests: [request("bar_newer")],
    });
    expect(
      queryClient.getQueryState(browserAccessRequestsQueryKey())?.isInvalidated,
    ).toBe(true);
    // An Allow minted a grant; this window's socket may have missed saying so.
    expect(
      queryClient.getQueryState(browserAccessGrantsQueryKey())?.isInvalidated,
    ).toBe(true);
  });
});
