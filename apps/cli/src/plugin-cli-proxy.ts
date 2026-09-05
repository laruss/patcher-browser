import {
  resolveContextProjectId,
  resolveContextThreadId,
} from "./context-env.js";
import { cliFetch } from "./client.js";
import { describeRefusedCredential } from "./app-credential-hint.js";

/**
 * Plugin-contributed `patcher` subcommands (server design §4.4). The CLI fetches
 * metadata from GET /api/v1/plugins/contributions and proxies invocations to
 * POST /api/v1/plugins/:id/cli — plugin code only ever runs server-side.
 */
export interface PluginCliContributionEntry {
  pluginId: string;
  name: string;
  summary: string;
  commands: Array<{ name: string; summary: string; usage: string }>;
}

const CONTRIBUTIONS_TIMEOUT_MS = 2000;

/**
 * Result of asking the server for plugin CLI contributions. "unreachable"
 * (fetch threw: server down, blocked, timeout) is distinguished from
 * "invalid" (an old server without the route, or a malformed payload) so
 * unknown-command handling can tell the user to start Patcher instead of printing
 * a misleading "unknown command" for a plugin command that would exist if Patcher
 * were up. The thrown error is kept: EPERM (blocked shell) and a timeout mean
 * something very different from ECONNREFUSED (nothing listening).
 */
export type PluginCliContributionsResult =
  | { outcome: "ok"; contributions: PluginCliContributionEntry[] }
  | { outcome: "unreachable"; cause: unknown }
  | { outcome: "unauthorized" }
  | { outcome: "invalid" };

/**
 * Diagnose a failed probe of the server without overclaiming: only when every
 * connection attempt reports ECONNREFUSED is there evidence that Patcher is not
 * running. Blocked connections (sandboxed agent shells) and timeouts name the
 * address and errno so the reader — often an agent — does not declare a
 * running Patcher dead.
 */
export function describeUnreachableServer(
  baseUrl: string,
  cause: unknown,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): string {
  let blockedCode: "EPERM" | "EACCES" | undefined;
  let timedOut = false;
  const messages: string[] = [];
  const terminalCodes: Array<string | undefined> = [];
  const seen = new Set<object>();
  const pending: unknown[] = [cause];

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) {
      terminalCodes.push(undefined);
      continue;
    }
    if (seen.has(current)) {
      terminalCodes.push(undefined);
      continue;
    }
    seen.add(current);
    const record = current as {
      cause?: unknown;
      code?: unknown;
      errors?: unknown;
      name?: unknown;
      message?: unknown;
    };
    const code = typeof record.code === "string" ? record.code : undefined;
    if (code === "EPERM" || code === "EACCES") {
      blockedCode ??= code;
    }
    if (record.name === "TimeoutError") {
      timedOut = true;
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      messages.push(record.message);
    }

    const children: unknown[] = [];
    if (record.cause !== undefined && record.cause !== null) {
      children.push(record.cause);
    }
    if (Array.isArray(record.errors)) {
      children.push(...record.errors);
    }
    if (children.length === 0) {
      terminalCodes.push(code);
      continue;
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  if (blockedCode !== undefined) {
    return (
      `Cannot reach Patcher at ${baseUrl}: ${blockedCode} — the connection was blocked. ` +
      `Patcher may still be running; check sandbox or firewall rules for this shell.`
    );
  }
  if (timedOut) {
    return `Patcher did not respond at ${baseUrl} within ${timeoutMs}ms — it may be busy or unreachable.`;
  }
  if (
    terminalCodes.length > 0 &&
    terminalCodes.every((code) => code === "ECONNREFUSED")
  ) {
    return `Patcher is not running at ${baseUrl} — open the Patcher app, then re-run this command.`;
  }
  return `Cannot reach Patcher at ${baseUrl}: ${
    messages.length > 0 ? messages.join(": ") : String(cause)
  }`;
}

/** Fetch plugin CLI contributions with a short timeout. */
export async function fetchPluginCliContributions(
  baseUrl: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<PluginCliContributionsResult> {
  let response: Response;
  try {
    response = await cliFetch(`${baseUrl}/api/v1/plugins/contributions`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { outcome: "unreachable", cause: error };
  }
  try {
    // A refusal, not a malformed answer. Told apart because "invalid" falls
    // through to commander, which then reports `patcher browser` as an unknown
    // command — advice about a command that exists, for a problem that is a
    // missing credential.
    if (response.status === 401) return { outcome: "unauthorized" };
    if (!response.ok) return { outcome: "invalid" };
    const parsed = (await response.json()) as {
      cliCommands?: unknown;
    } | null;
    const cliCommands = parsed?.cliCommands;
    if (!Array.isArray(cliCommands)) return { outcome: "invalid" };
    return {
      outcome: "ok",
      contributions: cliCommands.filter(
        (entry): entry is PluginCliContributionEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { pluginId?: unknown }).pluginId === "string" &&
          typeof (entry as { name?: unknown }).name === "string",
      ),
    };
  } catch {
    return { outcome: "invalid" };
  }
}

export interface DisabledPluginSummary {
  id: string;
  enabled: boolean;
  status: string | null;
  statusDetail: string | null;
}

/**
 * Every installed-but-disabled plugin, so an unknown command can say what might
 * have provided it. Best effort: any failure returns an empty list.
 *
 * A disabled plugin's factory never ran, so it has registered no CLI command and
 * the server does not know its name either — which is why this cannot answer
 * "which plugin provides `patcher browser`" and instead answers "these are off".
 * That is worth doing rather than skipping: measured on 2026-09-05, with
 * `browser-tools` disabled `patcher browser` printed `unknown command 'browser'`
 * and nothing else, which reads as "no such feature" to the agent most likely to
 * be running it.
 */
export async function listDisabledPlugins(
  baseUrl: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<DisabledPluginSummary[]> {
  try {
    const response = await cliFetch(`${baseUrl}/api/v1/plugins`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    const parsed = (await response.json()) as { plugins?: unknown } | null;
    if (!Array.isArray(parsed?.plugins)) return [];
    return parsed.plugins.flatMap((entry): DisabledPluginSummary[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as {
        id?: unknown;
        enabled?: unknown;
        status?: unknown;
        statusDetail?: unknown;
      };
      if (typeof record.id !== "string") return [];
      if (typeof record.enabled !== "boolean") return [];
      if (record.enabled !== false && record.status !== "disabled") return [];
      return [
        {
          id: record.id,
          enabled: record.enabled,
          status: typeof record.status === "string" ? record.status : null,
          statusDetail:
            typeof record.statusDetail === "string"
              ? record.statusDetail
              : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** How many disabled plugins an unknown-command message will name. */
const NAMED_DISABLED_PLUGINS = 6;

/**
 * What to say about an unknown command, and whether it is the whole answer.
 *
 * `resolved` names the plugin: the command *is* a disabled plugin's id, which is
 * the `patcher <id>` convention the builtins follow, so there is nothing left to
 * guess and commander's "unknown command" would only contradict it.
 *
 * `hint` is a guess and says so. The command may belong to a disabled plugin
 * under another name — `browser-tools` provides `patcher browser`, and a
 * disabled plugin has registered nothing, so neither the CLI nor the server
 * knows the name. It may equally be a typo. The two cannot be told apart here,
 * so the hint is printed *and* commander still gets to say its piece: `patcher
 * statsu` must keep "unknown command" and "Did you mean status?", which is the
 * regression the first version of this shipped — with browser-tools disabled by
 * default, every typo on every machine took the plugin branch.
 */
export type UnknownPluginCommandAdvice =
  | { kind: "resolved"; message: string }
  | { kind: "hint"; message: string };

export function describeUnknownPluginCommand(
  candidate: string,
  disabled: readonly DisabledPluginSummary[],
): UnknownPluginCommandAdvice | null {
  const exact = disabled.find((entry) => entry.id === candidate);
  if (exact !== undefined) {
    return {
      kind: "resolved",
      message:
        `patcher ${candidate} is provided by the "${exact.id}" plugin, which is disabled — ` +
        `run \`patcher plugin enable ${exact.id}\` or enable it in Plugins.`,
    };
  }
  if (disabled.length === 0) return null;
  const named = disabled
    .slice(0, NAMED_DISABLED_PLUGINS)
    .map((entry) => entry.id);
  const rest = disabled.length - named.length;
  return {
    kind: "hint",
    message:
      `Note: a plugin's command is served only while that plugin is enabled, and ` +
      `these are off: ${named.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}. ` +
      `If \`${candidate}\` is one of theirs, \`patcher plugin info <id>\` says which, ` +
      `and \`patcher plugin enable <id>\` turns it on.`,
  };
}

export function findPluginCliCommand(
  contributions: readonly PluginCliContributionEntry[],
  name: string,
): PluginCliContributionEntry | undefined {
  return contributions.find((entry) => entry.name === name);
}

/**
 * The first CLI token is a plugin-proxy candidate only when it looks like a
 * command (not a flag) and no core command claims it. Core commands always
 * win: commander resolved them before this path runs.
 */
export function pluginProxyCandidate(
  firstArg: string | undefined,
  knownCommandNames: ReadonlySet<string>,
): string | null {
  if (firstArg === undefined || firstArg.length === 0) return null;
  if (firstArg.startsWith("-")) return null;
  if (knownCommandNames.has(firstArg)) return null;
  return firstArg;
}

interface PluginCliOutputStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
}

interface PluginCliOutputStreams {
  stdout: PluginCliOutputStream;
  stderr: PluginCliOutputStream;
}

async function writePluginCliOutput(
  stream: PluginCliOutputStream,
  value: string,
): Promise<void> {
  if (value.length === 0) return;
  const output = value.endsWith("\n") ? value : `${value}\n`;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.write(output, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

/**
 * Proxy one invocation to the server and mirror its output. Returns the
 * command's exit code after both output streams have flushed. Waiting for the
 * write callbacks is required because callers terminate the CLI process as
 * soon as this promise resolves; an immediate exit can otherwise drop every
 * buffered byte after the platform pipe capacity.
 */
export async function runPluginCliCommand(
  baseUrl: string,
  pluginId: string,
  argv: string[],
  streams: PluginCliOutputStreams = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  const threadId = resolveContextThreadId();
  const projectId = resolveContextProjectId();
  const response = await cliFetch(
    `${baseUrl}/api/v1/plugins/${encodeURIComponent(pluginId)}/cli`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        argv,
        cwd: process.cwd(),
        ...(threadId ? { threadId } : {}),
        ...(projectId ? { projectId } : {}),
      }),
    },
  );
  const result = (await response.json().catch(() => null)) as {
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    error?: unknown;
  } | null;
  if (result === null || typeof result.exitCode !== "number") {
    const credential =
      response.status === 401 ? describeRefusedCredential() : null;
    const message =
      typeof result?.error === "string"
        ? result.error
        : `Unexpected response from the plugin CLI endpoint (HTTP ${response.status})`;
    await writePluginCliOutput(
      streams.stderr,
      credential === null ? message : `${message}\n${credential}`,
    );
    return 1;
  }
  if (typeof result.stdout === "string" && result.stdout.length > 0) {
    await writePluginCliOutput(streams.stdout, result.stdout);
  }
  if (typeof result.stderr === "string" && result.stderr.length > 0) {
    await writePluginCliOutput(streams.stderr, result.stderr);
  }
  return result.exitCode;
}
