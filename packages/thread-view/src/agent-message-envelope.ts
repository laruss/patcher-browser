// `[bb …]` stays readable on purpose. This pattern is a *needle*, not a name:
// it only ever runs against text already in the database, and its one real
// caller (`user-message-parsing.ts`) uses it to recover attribution for
// cross-thread handoffs persisted before `senderThreadId` metadata existed —
// rows a pre-rename build wrote, whose bytes say `[bb …]`. Renaming it away does
// not break a build; it makes the recovery path unreachable for every row it
// exists to serve. New text is written as `[Patcher …]` by
// packages/templates/src/templates/agent-thread-message.md.
const AGENT_MESSAGE_ENVELOPE_PATTERN =
  /^\[(?:Patcher|bb) message from thread:([^;\]\s]+)(?:;[^\]]*)?\]\s*/;

export interface AgentMessageEnvelope {
  bodyStart: number;
  senderThreadId: string;
}

/** Parses Patcher's reserved cross-thread message envelope from persisted text. */
export function parseAgentMessageEnvelope(
  text: string,
): AgentMessageEnvelope | null {
  const match = AGENT_MESSAGE_ENVELOPE_PATTERN.exec(text);
  const senderThreadId = match?.[1];
  if (!match || !senderThreadId) return null;
  return {
    bodyStart: match[0].length,
    senderThreadId,
  };
}
