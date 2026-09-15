import { readFileSync } from "node:fs";
import {
  PATCHER_AGENT_KEY_ENV,
  PATCHER_AGENT_KEY_FILE_ENV,
} from "@patcher/config/agent-access-key";
import { toOptionalString } from "@patcher/config/strings";

/**
 * Whether this process holds a browser access grant, and where its key is.
 *
 * Three places ask, and they have to give the same answer: the fetch that
 * presents the key, the 401 hint that explains a refusal, and `mcp-serve`,
 * which offers only `browser` while it speaks for a grant. The key arrives in
 * `PATCHER_AGENT_KEY`, or — since #134, so that issuing one does not print it
 * into a terminal an agent may be reading — in a file named by
 * `PATCHER_AGENT_KEY_FILE`. The variable wins when both are set.
 *
 * **A file that cannot be read is still a grant.** A shell pointed at a key
 * file was handed a narrow credential, and a mistyped path must not quietly
 * turn it into a caller holding the app key: the refusals would then describe
 * the install-wide setting instead of the grant, and `mcp-serve` would offer
 * every command. So it presents nothing, and the 401 that follows says which
 * file it could not read.
 */
export type AgentAccessKeySource =
  | { kind: "none" }
  | {
      kind: "key";
      key: string;
      /** The file it was read from; absent when it came in the variable. */
      file?: string;
    }
  | { kind: "unreadable"; file: string; reason: string };

export function resolveAgentAccessKey(
  env: NodeJS.ProcessEnv = process.env,
): AgentAccessKeySource {
  const key = toOptionalString(env[PATCHER_AGENT_KEY_ENV]);
  if (key !== undefined) return { kind: "key", key };
  const file = toOptionalString(env[PATCHER_AGENT_KEY_FILE_ENV]);
  if (file === undefined) return { kind: "none" };
  try {
    const fromFile = toOptionalString(readFileSync(file, "utf8"));
    return fromFile === undefined
      ? { kind: "unreadable", file, reason: "it is empty" }
      : { kind: "key", key: fromFile, file };
  } catch (error) {
    return {
      kind: "unreadable",
      file,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
