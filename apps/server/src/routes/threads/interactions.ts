import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@patcher/server-contract";
import type { Hono } from "hono";
import {
  isApprovalPendingInteractionResolution,
  isConsentPendingInteraction,
} from "@patcher/domain";
import { z } from "zod";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { declaresThread } from "../plugin-consent.js";

const pendingInteractionIdSchema = z
  .string()
  .regex(/^pint_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/);

/**
 * A consent answer, riding the same route a plugin interaction's answer takes.
 *
 * Reusing `respondToInteraction` rather than adding a route: the app already
 * posts a value for whatever interaction the thread is holding, and the kind of
 * the stored interaction decides how that value is read. One shape of answer,
 * one endpoint.
 */
const consentInteractionAnswerSchema = z.object({ approved: z.boolean() });

function parsePendingInteractionId(rawInteractionId: string): string {
  const parsedInteractionId =
    pendingInteractionIdSchema.safeParse(rawInteractionId);
  if (!parsedInteractionId.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "Invalid pending interaction id",
    );
  }
  return parsedInteractionId.data;
}

export function registerThreadInteractionRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.interactions, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      deps.pendingInteractions.listPendingThreadInteractions(thread.id),
    );
  });

  get(routes.interaction, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      deps.pendingInteractions.getThreadInteraction({
        threadId: thread.id,
        interactionId: parsePendingInteractionId(
          context.req.param("interactionId"),
        ),
      }),
    );
  });

  post(routes.resolveInteraction, (context, payload) => {
    // Before the thread lookup: this is a fact about the caller and the shape of
    // what it is asking for, not about the resource, so it neither needs the row
    // nor should leak whether one exists.
    //
    // The same refusal the consent prompt below makes, for the same reason, on
    // the prompts that actually gate privilege. An approval interaction is what
    // a blocked tool call raises — a sandboxed command asking to run
    // unsandboxed, a write outside the workspace, a permission grant — so a turn
    // that could allow its own would hold every boundary the sandbox draws, and
    // the timeline would record the user as having allowed it.
    //
    // Only *allowing* is refused. `deny` lowers privilege, and `answer`
    // (a user question) and a plugin's form submit are other shapes entirely, so
    // `patcher thread interactions deny/answer --self` keeps working.
    if (
      declaresThread(context) &&
      isApprovalPendingInteractionResolution(payload) &&
      payload.decision !== "deny"
    ) {
      throw new ApiError(
        403,
        "invalid_request",
        "A permission prompt is allowed by the user, not from inside the turn that raised it. Nothing changed. Explain what you need and why in your reply instead.",
      );
    }
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId: parsePendingInteractionId(
          context.req.param("interactionId"),
        ),
        resolution: payload,
      }),
    );
  });

  post(routes.respondToInteraction, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (Buffer.byteLength(JSON.stringify(payload.value), "utf8") > 64 * 1024) {
      throw new ApiError(
        413,
        "invalid_request",
        "Interaction response exceeds 64 KiB",
      );
    }
    const interactionId = parsePendingInteractionId(
      context.req.param("interactionId"),
    );
    const current = deps.pendingInteractions.getThreadInteraction({
      threadId: thread.id,
      interactionId,
    });
    if (isConsentPendingInteraction(current)) {
      // The one caller a consent prompt must not accept is the one that raised
      // it. A request declaring a thread is a command inside a turn (the app
      // never sends the header), and an agent that answers its own prompt does
      // not just bypass the gate — it writes "the user allowed this" into the
      // thread, which is the record the prompt exists to leave. A declaration
      // rather than a credential, like the gate itself: it keeps the honest
      // path honest.
      if (declaresThread(context)) {
        throw new ApiError(
          403,
          "invalid_request",
          "A consent prompt is answered by the user, not from inside a turn. Nothing changed. Ask in your reply instead.",
        );
      }
      const answer = consentInteractionAnswerSchema.safeParse(payload.value);
      if (!answer.success) {
        throw new ApiError(
          400,
          "invalid_request",
          "Expected { approved: boolean } for a consent interaction",
        );
      }
      return context.json(
        deps.pendingInteractions.decideConsentInteraction({
          threadId: thread.id,
          interactionId,
          approved: answer.data.approved,
        }),
      );
    }
    return context.json(
      deps.pendingInteractions.respondToPluginInteraction({
        threadId: thread.id,
        interactionId,
        value: payload.value,
      }),
    );
  });

  post(routes.cancelInteraction, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const interactionId = parsePendingInteractionId(
      context.req.param("interactionId"),
    );
    const current = deps.pendingInteractions.getThreadInteraction({
      threadId: thread.id,
      interactionId,
    });
    // Dismissing a consent prompt is not a denial: the user closed it without
    // deciding, and the caller is told so rather than told "no".
    if (isConsentPendingInteraction(current)) {
      return context.json(
        deps.pendingInteractions.cancelConsentInteraction({
          threadId: thread.id,
          interactionId,
          reason: "user",
        }),
      );
    }
    return context.json(
      deps.pendingInteractions.cancelPluginInteraction({
        threadId: thread.id,
        interactionId,
        reason: "user",
      }),
    );
  });
}
