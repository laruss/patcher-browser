import type { TimelineUserConversationRow } from "@patcher/server-contract";

/**
 * Detect the closing bracket of a `[Patcher …]` prefix on non-user messages so the
 * renderer can split generated-message chrome from the user-readable body. We
 * never extract data from the prefix — only locate its boundary based on the
 * leading `[Patcher` marker. Trailing whitespace after `]` is absorbed into the
 * prefix region so block (`\n\n`) and inline (` `) writer-side separators
 * render identically: header on one line, body directly below, with no blank
 * gap.
 *
 * Returns the index in `text` where the body begins. `0` means "no muted
 * prefix" — render the text plain.
 */
export function computeMutedPrefixLength(
  initiator: TimelineUserConversationRow["initiator"],
  text: string,
): number {
  if (initiator === "user") return 0;
  if (!text.startsWith("[Patcher")) return 0;
  const closeIdx = text.indexOf("]");
  if (closeIdx === -1) return 0;
  let endIdx = closeIdx + 1;
  while (endIdx < text.length && /\s/.test(text.charAt(endIdx))) {
    endIdx += 1;
  }
  return endIdx;
}
