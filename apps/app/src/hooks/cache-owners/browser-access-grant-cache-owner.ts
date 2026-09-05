import type { QueryClient } from "@tanstack/react-query";
import type { SystemBrowserAccessGrantListResponse } from "@patcher/server-contract";
import { browserAccessGrantsQueryKey } from "../queries/query-keys";

/**
 * The grants list, after the one mutation that changes it from this app.
 *
 * Written rather than invalidated: revoking answers with the whole list, so a
 * refetch would ask for what the reply already carried — and the row that just
 * disappeared from "live" is exactly what somebody is looking at while they
 * click.
 */
export interface SetBrowserAccessGrantsArgs {
  queryClient: QueryClient;
  grants: SystemBrowserAccessGrantListResponse;
}

export function setBrowserAccessGrants(args: SetBrowserAccessGrantsArgs): void {
  args.queryClient.setQueryData(browserAccessGrantsQueryKey(), args.grants);
}
