import { z } from "zod";
import {
  BRANCH_LIST_QUERY_MAX_LENGTH,
  BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH,
  browserAccessGrantLevelSchema,
  browserCommandRecordDetail,
  browserCommandSchema,
  changedMessageLenientSchema,
  changedMessageSchema,
  gitBranchNameSchema,
} from "@patcher/domain";
import type { BrowserCommand, GitBranchName } from "@patcher/domain";

export {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@patcher/domain";

interface IncludeQueryValidationArgs {
  allowedValues: readonly string[];
  value: string;
}

export function isCommaSeparatedIncludeQueryValue(
  args: IncludeQueryValidationArgs,
): boolean {
  const requestedValues = args.value.split(",");
  return requestedValues.every(
    (value) => value.length > 0 && args.allowedValues.includes(value),
  );
}

export const threadContextWindowUsageSchema = z.object({
  usedTokens: z.number(),
  modelContextWindow: z.number(),
  estimated: z.boolean(),
});
export type ThreadContextWindowUsage = z.infer<
  typeof threadContextWindowUsageSchema
>;

export { gitBranchNameSchema };
export type { GitBranchName };

/**
 * Pre-thread checkout intent for an unmanaged workspace. Omitting this from
 * the workspace request means "don't touch HEAD"; including it asks the
 * daemon to switch to the named branch or create a server-named branch from
 * `baseBranch` before the thread starts.
 */
export const unmanagedBranchSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      name: gitBranchNameSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("new"), baseBranch: gitBranchNameSchema })
    .strict(),
]);
export type UnmanagedBranchSpec = z.infer<typeof unmanagedBranchSpecSchema>;

export const unmanagedWorkspaceSchema = z.object({
  type: z.literal("unmanaged"),
  path: z.string().min(1).nullable(),
  /**
   * If set, the daemon checks out this branch in the unmanaged workspace
   * before the thread starts. `existing` switches to a named branch; `new`
   * asks the server to mint a thread-scoped branch name and create it from
   * the requested base branch.
   */
  branch: unmanagedBranchSpecSchema.optional(),
});

/**
 * Identifies the base branch a managed worktree should be created from.
 * `named` carries an explicit branch name; `default` defers to the source's
 * default branch (resolved server-side so the daemon always receives a real
 * branch name).
 */
export const baseBranchSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: gitBranchNameSchema }),
  z.object({ kind: z.literal("default") }),
]);
export type BaseBranchSpec = z.infer<typeof baseBranchSpecSchema>;

export const managedWorktreeWorkspaceSchema = z.object({
  type: z.literal("managed-worktree"),
  /** Branch the new worktree should be based on. */
  baseBranch: baseBranchSpecSchema,
});

export const personalWorkspaceSchema = z.object({
  type: z.literal("personal"),
});

export const workspaceArgsSchema = z.discriminatedUnion("type", [
  unmanagedWorkspaceSchema,
  managedWorktreeWorkspaceSchema,
  personalWorkspaceSchema,
]);
export type WorkspaceArgs = z.infer<typeof workspaceArgsSchema>;

export const reuseEnvironmentSchema = z.object({
  type: z.literal("reuse"),
  environmentId: z.string().min(1),
});

export const hostEnvironmentSchema = z
  .object({
    type: z.literal("host"),
    hostId: z.string().min(1).optional(),
    workspace: workspaceArgsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.workspace.type !== "personal" && value.hostId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "hostId is required unless workspace.type is personal",
        path: ["hostId"],
      });
    }
  });

export const environmentArgsSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
]);
export type EnvironmentArgs = z.infer<typeof environmentArgsSchema>;

/**
 * Server-resolved environment default for thread creation: the server picks
 * the host and workspace using its own defaulting policy (personal workspace
 * for the personal project, a managed worktree on the primary host otherwise).
 * For callers — plugins, scripts — that should not re-derive compose-flow
 * policy. Accepted only by thread creation; other surfaces keep the explicit
 * {@link environmentArgsSchema}.
 */
export const projectDefaultEnvironmentSchema = z.object({
  type: z.literal("project-default"),
});

export const createThreadEnvironmentArgsSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
  projectDefaultEnvironmentSchema,
]);
export type CreateThreadEnvironmentArgs = z.infer<
  typeof createThreadEnvironmentArgsSchema
>;

export const pathListIncludeQueryValueSchema = z.enum(["true", "false"]);
export type PathListIncludeQueryValue = z.infer<
  typeof pathListIncludeQueryValueSchema
>;

export const branchListQuerySchema = z.object({
  query: z.string().min(1).max(BRANCH_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;

export const serverMessageSchema = changedMessageSchema;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * Lenient counterpart of {@link serverMessageSchema} for INBOUND parsing on
 * clients. The strict schema guards the server's outgoing boundary; clients
 * (SDK consumers, the web app) may be older than the server they talk to, so
 * they strip unknown fields and filter unknown change kinds instead of
 * dropping whole messages on additive server changes. Output stays assignable
 * to {@link ServerMessage}.
 */
export const serverMessageLenientSchema = changedMessageLenientSchema;

/**
 * Ephemeral server→client WebSocket message carrying a plugin's
 * `patcher.realtime.publish(channel, payload)` signal. V1 broadcasts to every
 * connected client — there is no per-channel subscription yet (client-side
 * consumption lands with the plugin frontend runtime). Nothing is persisted;
 * clients that predate this message type ignore it. `payload` is a
 * JSON-serializable value (publish normalizes `undefined` to `null`). Strict
 * schema guards the server's outgoing boundary (mirrors the thread-open signal
 * in threads.ts).
 */
export const pluginSignalSchema = z
  .object({
    type: z.literal("plugin-signal"),
    pluginId: z.string().min(1),
    channel: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();
export type PluginSignal = z.infer<typeof pluginSignalSchema>;

/**
 * Lenient counterpart of {@link pluginSignalSchema} for INBOUND parsing on
 * clients (mirrors threadOpenSignalLenientSchema): unknown fields from a
 * newer server are stripped instead of dropping the whole signal.
 */
export const pluginSignalLenientSchema = z.object({
  type: z.literal("plugin-signal"),
  pluginId: z.string().min(1),
  channel: z.string().min(1),
  payload: z.unknown(),
});

/**
 * Who asked for a browser command, when the server can say.
 *
 * The app is the only place a person can be told that something other than
 * them is driving their browser — Electron draws no "a program is controlling
 * this browser" banner, and a `WebContentsView` cannot be decorated from the
 * page side. So the fact has to travel: the server knows whose request it is
 * answering, forty call sites away from the socket that carries the command,
 * and until this field existed it spent that knowledge on one question — may
 * this caller do this — and dropped it.
 *
 * **Absent means nobody the server can name.** Usually that is the app itself —
 * its own browsing, a plugin's page script, a toolbar item's handler: work the
 * user started, in the window they are looking at, which needs no indicator and
 * must not get one. A missing field also means an older server, and reads the
 * same way, which is the right default of the two.
 *
 * A plugin running in its **own process** used to be in that "nobody" set and
 * is not: the host serves its browser call on a channel message, in a fresh
 * async context the ambient scope cannot reach, and the caller is carried over
 * the plugin channel instead — keyed by the id the host minted for its own
 * outbound call, never by what the plugin says it is. See
 * `browser-caller-handoff.ts` in the server. What is still nobody's is the work
 * a plugin does by itself: a schedule, a background service, a page script.
 *
 * `outside` has no fields on purpose. A caller holding the app key from a
 * terminal is exactly as identified as the app key is — which is to say the
 * install knows *that* something outside Patcher is driving and cannot know
 * *what*. Naming it anything more specific would be an invention. A grant is
 * the answer to that, and carries the name a person gave it.
 */
export const browserCommandIssuerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread"), threadId: z.string().min(1) }),
  z.object({
    kind: z.literal("grant"),
    grantId: z.string().min(1),
    label: z.string().min(1),
    level: browserAccessGrantLevelSchema,
  }),
  z.object({ kind: z.literal("outside") }),
]);
export type BrowserCommandIssuer = z.infer<typeof browserCommandIssuerSchema>;

/**
 * Ephemeral server→client request asking the app to perform one browser command
 * on behalf of an agent, and to answer with a `browser-command.response` client
 * message carrying the same `requestId`.
 *
 * Unlike the three signals above this is **not** a broadcast: it goes to the one
 * socket registered as the browser host, because a command must be performed
 * once and answered once. Strict schema guards the server's outgoing boundary,
 * mirroring the thread-open signal.
 */
export const browserCommandRequestSignalSchema = z
  .object({
    type: z.literal("browser-command-request"),
    requestId: z.string().min(1).max(128),
    command: browserCommandSchema,
    /** Who this is for, when the server can say. See the schema. */
    issuer: browserCommandIssuerSchema.optional(),
  })
  .strict();
export type BrowserCommandRequestSignal = z.infer<
  typeof browserCommandRequestSignalSchema
>;

/**
 * Lenient counterpart for INBOUND parsing on clients, mirroring
 * {@link pluginSignalLenientSchema}. Only the envelope is restated — the command
 * union itself is shared from `@patcher/domain` rather than duplicated, because a
 * twelve-member union written twice would drift on the first addition.
 */
export const browserCommandRequestSignalLenientSchema = z.object({
  type: z.literal("browser-command-request"),
  requestId: z.string().min(1).max(128),
  command: browserCommandSchema,
  // Restated here or the app would never see it: a lenient schema strips what
  // it does not name, so leaving it out is the same as not sending it.
  //
  // `.catch` because the union is closed and this schema's whole job is to
  // survive a newer server: a fourth kind would otherwise fail the parse, and
  // `ws.ts` drops a signal it cannot parse — so an *older app* would stop
  // answering browser commands altogether and every tool call would time out.
  // Degrading to "no indicator" is the failure this copy exists to have.
  issuer: browserCommandIssuerSchema.optional().catch(undefined),
});

/**
 * What a window is told about the command that is being performed, which is the
 * difference between "something is driving" and "something is doing this".
 *
 * `name` is the command's own type and `detail` its rendered line, the same two
 * a trace step carries and rendered by the same function
 * (`browserCommandRecordDetail`) — so the row in one window and the trace the
 * caller takes away say the same words. Its length is the trace's, which is
 * what that function cuts to: the field cannot be the reason a frame fails to
 * build.
 *
 * The rendering, not the command: the JSON of a `page.storage` write is the
 * person's own cookies, and this frame goes to every other window.
 */
export const browserDrivingCommandSchema = z
  .object({
    name: z.string().max(64),
    detail: z.string().max(BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH),
  })
  .strict();
export type BrowserDrivingCommand = z.infer<typeof browserDrivingCommandSchema>;

/**
 * The pair, for one command.
 *
 * Both sides of this signal build it: the server for the windows it tells, and
 * the window performing the command for its own chrome — which has the command
 * in hand and no frame to read. One function so the two cannot drift into
 * saying different things about the same command in two windows.
 */
export function browserDrivingCommandFor(
  command: BrowserCommand,
): BrowserDrivingCommand {
  return {
    name: command.type,
    detail: browserCommandRecordDetail(command),
  };
}

/**
 * How the command ended, in the same two fields a trace step ends with.
 *
 * `null` in place of one of these is not "it succeeded" — it is **no answer at
 * all**, which is what a window sees when the command timed out, when the
 * window performing it went away, or when the send itself failed. A record that
 * showed those as finished would be claiming an outcome nobody has.
 */
export const browserDrivingOutcomeSchema = z
  .object({
    ok: z.boolean(),
    /** The failure's code, or null when it succeeded. */
    error: z.string().max(64).nullable(),
  })
  .strict();
export type BrowserDrivingOutcome = z.infer<typeof browserDrivingOutcomeSchema>;

/**
 * Ephemeral server→client signal telling a window that a browser command is
 * being performed in a **different** window.
 *
 * The command itself goes to one socket, because it must be performed once and
 * answered once — so the window serving it is the only one that learns anybody
 * is driving, and a person reading a thread in another window sees nothing
 * while an agent works. This carries the same `issuer` to the app's other
 * windows so each of them can say so in its own chrome.
 *
 * **Two phases rather than a computed state**, because the linger and the
 * handover between two drivers are the client's own rules and already written
 * there (`browser-agent/driving.ts`): a window that hears `started` and
 * `settled` runs exactly the code the serving window runs, instead of a second
 * spelling of it here that would drift.
 *
 * **A union rather than one object with optional halves**, because the two
 * phases carry different things and always did: a start knows the command and
 * cannot know how it ended, a settle knows how it ended and would only be
 * repeating the command. Optional fields on one object would let the server
 * build a start with no command, or a settle claiming one, and nothing would
 * say which is meant.
 *
 * **`issuer` is required.** A command with nobody to name is the app's own
 * browsing and must stay silent, so it is not announced at all — an absent
 * issuer is not a driver whose name is unknown, it is the person's own work.
 *
 * **`requestId` is the same id the command carries, and it is read.** A window
 * that registers — or reconnects — part-way through a command is still in the
 * audience for that command's `settled`, and the client keys what it is showing
 * by that id: a settle it cannot pair with a start it saw would take down the
 * row of another command the same caller started since. So the client ignores
 * one, which it can only do because the phases are named.
 */
export const browserDrivingSignalSchema = z.discriminatedUnion("phase", [
  z
    .object({
      type: z.literal("browser-driving"),
      requestId: z.string().min(1).max(128),
      phase: z.literal("started"),
      issuer: browserCommandIssuerSchema,
      command: browserDrivingCommandSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("browser-driving"),
      requestId: z.string().min(1).max(128),
      phase: z.literal("settled"),
      issuer: browserCommandIssuerSchema,
      outcome: browserDrivingOutcomeSchema.nullable(),
    })
    .strict(),
]);
export type BrowserDrivingSignal = z.infer<typeof browserDrivingSignalSchema>;

/**
 * Lenient counterpart for INBOUND parsing on clients, mirroring
 * {@link browserCommandRequestSignalLenientSchema}.
 *
 * The issuer union is closed here too, and the same `.catch` cannot help: a
 * signal whose only content is who is driving has nothing left to show once the
 * name is dropped. So a fourth kind fails this parse and the signal is ignored,
 * which is the pre-existing behaviour — no indicator — rather than a broken one.
 * A `phase` this app does not know is worth the same treatment for the same
 * reason.
 *
 * **The command and the outcome are optional here and required there**, and
 * neither is strict here, which is the one place these two schemas deliberately
 * disagree. Strict guards what
 * the server sends, and a start with no command would be the server forgetting.
 * Lenient parses what arrived, and a window loaded from a server that predates
 * these fields still knows who is driving — which is the whole signal — so
 * dropping the frame over the half it cannot have would trade a working
 * indicator for a missing one.
 */
/**
 * The two payloads without `.strict()`, for the lenient side only.
 *
 * `optional()` on a strict object forgives the field's absence and nothing
 * inside it, so a newer server that adds a field to either of these — the
 * additive change this wire is *for* — would make an old window drop the whole
 * frame. Dropping a `started` loses the row; dropping a `settled` is worse,
 * since nothing else ends a command this window is only being told about: the
 * indicator would stay on until the socket next reconnects.
 *
 * The lengths stay. A field a newer server adds is a change this wire allows; a
 * `detail` longer than the cap or a code longer than 64 is a server breaking its
 * own outgoing schema, and there is nothing to be gained by rendering it.
 */
const browserDrivingCommandLenientSchema = z.object({
  name: z.string().max(64),
  detail: z.string().max(BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH),
});
const browserDrivingOutcomeLenientSchema = z.object({
  ok: z.boolean(),
  error: z.string().max(64).nullable(),
});

export const browserDrivingSignalLenientSchema = z.discriminatedUnion("phase", [
  z.object({
    type: z.literal("browser-driving"),
    requestId: z.string().min(1).max(128),
    phase: z.literal("started"),
    issuer: browserCommandIssuerSchema,
    command: browserDrivingCommandLenientSchema.optional(),
  }),
  z.object({
    type: z.literal("browser-driving"),
    requestId: z.string().min(1).max(128),
    phase: z.literal("settled"),
    issuer: browserCommandIssuerSchema,
    outcome: browserDrivingOutcomeLenientSchema.nullish(),
  }),
]);
/**
 * What a client actually has after parsing one, which is not
 * {@link BrowserDrivingSignal}: the two halves the lenient schema forgives are
 * missing from this type, so a window cannot read a command the frame never
 * carried without saying what it does when there is none.
 */
export type BrowserDrivingSignalReceived = z.infer<
  typeof browserDrivingSignalLenientSchema
>;

export const workspaceFileSchema = z.object({
  path: z.string(),
  name: z.string(),
});
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

export const workspacePathEntryKindSchema = z.enum(["file", "directory"]);

export const workspacePathEntrySchema = z.object({
  kind: workspacePathEntryKindSchema,
  path: z.string(),
  name: z.string(),
  score: z.number(),
  positions: z.array(z.number().int().nonnegative()),
});
export type WorkspacePathEntry = z.infer<typeof workspacePathEntrySchema>;

export const workspaceFileListResponseSchema = z.object({
  files: z.array(workspaceFileSchema),
  truncated: z.boolean(),
});
export type WorkspaceFileListResponse = z.infer<
  typeof workspaceFileListResponseSchema
>;

export const workspacePathListResponseSchema = z.object({
  paths: z.array(workspacePathEntrySchema),
  truncated: z.boolean(),
});
export type WorkspacePathListResponse = z.infer<
  typeof workspacePathListResponseSchema
>;
