import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { JsonValue, PendingInteraction } from "@patcher/domain";
import type { ResolvePendingInteractionRequest } from "@patcher/server-contract";
import { sdk } from "@/lib/sdk";
import { invalidateThreadPendingInteractionResolutionQueries } from "../cache-owners/mutation-cache-effects";

export interface ResolveThreadPendingInteractionMutationRequest {
  threadId: string;
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
}

export interface RespondToThreadPendingInteractionMutationRequest {
  threadId: string;
  interactionId: string;
  value: JsonValue;
}

/**
 * Answer an interaction that carries a value rather than an approval decision.
 *
 * Consent prompts use this: their answer is `{ approved }`, and the server
 * reads it according to the kind of interaction the thread is holding.
 */
export function useRespondToThreadPendingInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to answer pending interaction.",
      showErrorToast: false,
    },
    mutationFn: ({
      threadId,
      interactionId,
      value,
    }: RespondToThreadPendingInteractionMutationRequest): Promise<PendingInteraction> =>
      sdk.threads.interactions.respond({ interactionId, threadId, value }),
    onSuccess: (interaction, variables) => {
      invalidateThreadPendingInteractionResolutionQueries({
        queryClient,
        threadId: variables.threadId,
      });
      return interaction;
    },
  });
}

export function useResolveThreadPendingInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to resolve pending interaction.",
      showErrorToast: false,
    },
    mutationFn: ({
      threadId,
      interactionId,
      resolution,
    }: ResolveThreadPendingInteractionMutationRequest): Promise<PendingInteraction> =>
      sdk.threads.interactions.resolve({
        interactionId,
        resolution,
        threadId,
      }),
    onSuccess: (interaction, variables) => {
      invalidateThreadPendingInteractionResolutionQueries({
        queryClient,
        threadId: variables.threadId,
      });
      return interaction;
    },
  });
}
