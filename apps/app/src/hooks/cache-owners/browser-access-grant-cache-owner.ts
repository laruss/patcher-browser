import type { QueryClient } from "@tanstack/react-query";
import type { SystemBrowserAccessGrantListResponse } from "@patcher/server-contract";
import { browserAccessGrantsQueryKey } from "../queries/query-keys";

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
