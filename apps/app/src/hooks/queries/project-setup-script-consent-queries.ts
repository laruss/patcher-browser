import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectSetupScriptConsentsResponse } from "@patcher/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import { useProjectDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { invalidateProjectSetupScriptConsentQueries } from "@/hooks/cache-owners/mutation-cache-effects";
import { projectSetupScriptConsentsQueryKey } from "./query-keys";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "./query-policies";

/**
 * What this install remembers about the project's `.patcher-env-setup.sh`.
 *
 * Through the contract client rather than `@/lib/sdk` on purpose: the SDK is
 * also what a plugin holds, and whether a script may run on the machine outside
 * every sandbox is not a plugin's to answer — the server refuses one on these
 * routes. Same reason the machine's permission ceiling is here and not there.
 */
export function useProjectSetupScriptConsents(projectId: string | undefined) {
  useProjectDetailRealtimeSubscription(projectId, {
    enabled: projectId !== undefined,
  });
  return useQuery<ProjectSetupScriptConsentsResponse>({
    queryKey: projectSetupScriptConsentsQueryKey(projectId ?? ""),
    queryFn: ({ signal }) =>
      request<ProjectSetupScriptConsentsResponse>(
        apiClient.projects[":id"]["setup-script-consents"].$get(
          { param: { id: projectId! } },
          requestOptions(signal),
        ),
      ),
    enabled: projectId !== undefined,
    // A provision on any machine can add a question, and the project's own
    // broadcast is what says so.
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
  });
}

interface SetupScriptConsentMutationArgs {
  projectId: string;
  consentId: string;
}

/** Answer a question the daemon raised where nobody could see it. */
export function useAllowProjectSetupScript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, consentId }: SetupScriptConsentMutationArgs) =>
      request(
        apiClient.projects[":id"]["setup-script-consents"][":consentId"][
          "allow"
        ].$post({ param: { id: projectId, consentId } }),
      ),
    onSuccess: (_result, { projectId }) => {
      invalidateProjectSetupScriptConsentQueries({ projectId, queryClient });
    },
  });
}

/** Take an allow back, or drop a question rather than answering it. */
export function useForgetProjectSetupScript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, consentId }: SetupScriptConsentMutationArgs) =>
      request(
        apiClient.projects[":id"]["setup-script-consents"][
          ":consentId"
        ].$delete({ param: { id: projectId, consentId } }),
      ),
    onSuccess: (_result, { projectId }) => {
      invalidateProjectSetupScriptConsentQueries({ projectId, queryClient });
    },
  });
}
