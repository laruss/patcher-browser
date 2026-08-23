import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import type { TasksStore } from "../db";
import { isSideChatShapedThread } from "../shared/side-chat";

export interface DeliverCommentInput {
  taskId: string;
  commentId: string;
  body: string;
  authorName: string;
}

export type CommentDeliveryOutcome =
  | { threadId: string; status: "delivered" }
  | { threadId: string | null; status: "skipped"; reason: string }
  | { threadId: string; status: "failed"; reason: string };

export interface CommentDeliveryResult {
  notifiedCount: number;
  outcomes: CommentDeliveryOutcome[];
}

function steerPrompt(
  taskKey: string,
  authorName: string,
  body: string,
): string {
  return (
    `New comment on task ${taskKey} from ${authorName}: ${body}\n\n` +
    "Treat this as updated context for your work on this task; " +
    `reply via patcher tasks comment ${taskKey} when relevant.`
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function deliverCommentToLatestAgent(
  patcher: PatcherPluginApi,
  store: TasksStore,
  input: DeliverCommentInput,
): Promise<CommentDeliveryResult> {
  const task = store.getTask(input.taskId);
  if (!task) throw new Error(`Task not found: ${input.taskId}`);

  // The CLI can explicitly notify while preserving an agent-authored comment.
  // Exclude the comment being delivered so it cannot select its own thread.
  const latestReply = store.getLatestAgentComment(
    input.taskId,
    input.commentId,
  );
  if (!latestReply) return { notifiedCount: 0, outcomes: [] };
  if (latestReply.threadId === null) {
    return {
      notifiedCount: 0,
      outcomes: [
        {
          threadId: null,
          status: "skipped",
          reason: "latest agent reply has no thread",
        },
      ],
    };
  }

  const threadId = latestReply.threadId;
  const prompt = steerPrompt(task.key, input.authorName, input.body);
  let outcome: CommentDeliveryOutcome;
  try {
    const thread = await patcher.sdk.threads.get({ threadId });
    if (isSideChatShapedThread(thread)) {
      outcome = {
        threadId,
        status: "skipped",
        reason: "latest agent reply belongs to a side chat",
      };
    } else {
      await patcher.sdk.threads.send({
        threadId,
        input: [{ type: "text", text: prompt, mentions: [] }],
        mode: "steer-if-active",
      });
      outcome = { threadId, status: "delivered" };
    }
  } catch (error) {
    const reason = errorMessage(error);
    patcher.log.warn(
      `failed to deliver comment ${input.commentId} to thread ${threadId}: ${reason}`,
    );
    outcome = { threadId, status: "failed", reason };
  }

  return {
    notifiedCount: outcome.status === "delivered" ? 1 : 0,
    outcomes: [outcome],
  };
}
