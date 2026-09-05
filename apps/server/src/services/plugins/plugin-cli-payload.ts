import type { PluginCliContext } from "./plugin-api.js";

/**
 * The part of a plugin CLI context that is *data*.
 *
 * A CLI invocation crosses a process boundary for any plugin the host did not
 * build in, so the payload it carries has to be serializable — which the
 * context as a whole is not: `signal` is an `AbortSignal`, and the child gets
 * one of its own from the callback machinery rather than a copy of this one.
 * Same split the agent-tool path makes, one function over.
 *
 * Spelled as a named list rather than as a spread with `signal` deleted, so a
 * field added to the context tomorrow does not cross the boundary because
 * nobody looked. That is a decision per field, and the one this file was
 * extracted for makes the point: `caller` is the host's answer about who is
 * running the command, which a plugin may *report* and cannot act on — so it
 * travels, while an `AbortSignal` cannot and a future handle should not.
 */
export function pluginCliPayloadContext(
  ctx: PluginCliContext,
): Omit<PluginCliContext, "signal"> {
  return {
    cwd: ctx.cwd,
    threadId: ctx.threadId,
    projectId: ctx.projectId,
    caller: ctx.caller,
  };
}
