import type { QueryClient } from "@tanstack/react-query";
import type {
  SystemBrowserAccessGrantListResponse,
  SystemBrowserAccessRequestListResponse,
} from "@patcher/server-contract";
import {
  browserAccessGrantsQueryKey,
  browserAccessRequestsQueryKey,
} from "../queries/query-keys";

/**
 * The grants list, after a mutation from this app changes it.
 *
 * Written rather than invalidated: every mutation here answers with the whole
 * list, so a refetch would ask for what the reply already carried — and the row
 * that just changed state is exactly what somebody is looking at while they
 * click.
 */
export interface SetBrowserAccessGrantsArgs {
  queryClient: QueryClient;
  grants: SystemBrowserAccessGrantListResponse;
}

export function setBrowserAccessGrants(args: SetBrowserAccessGrantsArgs): void {
  args.queryClient.setQueryData(browserAccessGrantsQueryKey(), args.grants);
}

/**
 * After this window answered a request: the answered row goes at once, and both
 * lists are read again.
 *
 * Not the reply written over the cache, unlike the grants above. The reply is
 * the list as it stood when this answer landed, and a `config-changed` from
 * another window's ask or answer can refetch a newer one before the reply is
 * handled here — overwriting it would hide a new question or bring back an
 * answered one. The grants are read again too, because an Allow minted one, and
 * this window's socket may be the one that missed saying so.
 */
export interface ReconcileAnsweredBrowserAccessRequestArgs {
  queryClient: QueryClient;
  requestId: string;
}

export function reconcileAnsweredBrowserAccessRequest(
  args: ReconcileAnsweredBrowserAccessRequestArgs,
): void {
  args.queryClient.setQueryData<SystemBrowserAccessRequestListResponse>(
    browserAccessRequestsQueryKey(),
    (current) =>
      current === undefined
        ? current
        : {
            requests: current.requests.filter(
              (request) => request.id !== args.requestId,
            ),
          },
  );
  void args.queryClient.invalidateQueries({
    queryKey: browserAccessRequestsQueryKey(),
  });
  void args.queryClient.invalidateQueries({
    queryKey: browserAccessGrantsQueryKey(),
  });
}
