import { resolveAppApiKey } from "@patcher/config/app-key";
import {
  PatcherHttpError,
  PatcherRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
  createNodePatcherSdk,
  type PatcherSdk as PatcherSdkContract,
  type CreateNodePatcherSdkArgs,
} from "@patcher/sdk/node";
import type {
  PatcherRealtimeSubscribeArgs,
  PatcherRealtimeSocket,
  PatcherRealtimeSocketFactory,
  PatcherRealtimeSocketMessageEvent,
  ThreadGetResult,
  ThreadStatusArgs,
} from "@patcher/sdk/node";

export {
  PatcherHttpError,
  PatcherRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
};
export type * from "@patcher/sdk/node";
export type {
  JsonValue,
  PermissionMode,
  PromptInput,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
  ThreadStatus,
} from "@patcher/sdk/node";
export type {
  BaseBranchSpec,
  CreateExecutionInputSources,
  EnvironmentArgs,
  ExistingThreadExecutionInputSources,
  UnmanagedBranchSpec,
  WorkspaceArgs,
} from "@patcher/sdk/node";
export type { CallerExecutionInputSource as ExecutionInputSource } from "@patcher/sdk/node";
// The canonical SDK contract is itself named `PatcherSdk`, so the class below
// shadows it in the `export type *` above and it reaches the published `.d.ts`
// under no name at all. Before the rename the interface and the class differed
// in case, which is what kept both exported. Name the interface explicitly so
// callers can still type a variable by the contract, not by the concrete class.
export type { PatcherSdkContract };

export type PatcherSdkOptions = CreateNodePatcherSdkArgs;
export type PatcherSdkRealtimeSubscribeArgs = PatcherRealtimeSubscribeArgs;
export type PatcherSdkRealtimeSocket = PatcherRealtimeSocket;
export type PatcherSdkRealtimeSocketFactory = PatcherRealtimeSocketFactory;
export type PatcherSdkRealtimeSocketMessageEvent =
  PatcherRealtimeSocketMessageEvent;
export type PatcherSdkStatusArea = PatcherSdkContract["status"];
export type PatcherSdkSkillsArea = PatcherSdkContract["skills"];
export type PatcherSdkTerminalsArea = PatcherSdkContract["terminals"];
export type PatcherSdkThread = ThreadGetResult;
export type PatcherSdkThreadsArea = PatcherSdkContract["threads"];
export type ThreadIdArgs = ThreadStatusArgs;
export type PatcherHttpErrorConstructor = typeof PatcherHttpError;
export type PatcherRequestTimeoutErrorConstructor =
  typeof PatcherRequestTimeoutError;
export type ThreadWaitTimeoutErrorConstructor = typeof ThreadWaitTimeoutError;
export type ThreadWaitUnreachableErrorConstructor =
  typeof ThreadWaitUnreachableError;

/**
 * Public npm façade over the canonical Patcher SDK. Keep every area typed from
 * `@patcher/sdk` so the packaged SDK cannot drift behind the CLI or web app.
 */
export class PatcherSdk implements PatcherSdkContract {
  readonly browserHistory: PatcherSdkContract["browserHistory"];
  readonly environments: PatcherSdkContract["environments"];
  readonly files: PatcherSdkContract["files"];
  readonly guide: PatcherSdkContract["guide"];
  readonly hosts: PatcherSdkContract["hosts"];
  readonly plugins: PatcherSdkContract["plugins"];
  readonly projects: PatcherSdkContract["projects"];
  readonly providers: PatcherSdkContract["providers"];
  readonly skills: PatcherSdkContract["skills"];
  readonly status: PatcherSdkContract["status"];
  readonly system: PatcherSdkContract["system"];
  readonly terminals: PatcherSdkContract["terminals"];
  readonly theme: PatcherSdkContract["theme"];
  readonly threadSections: PatcherSdkContract["threadSections"];
  readonly threads: PatcherSdkContract["threads"];
  readonly subscribe: PatcherSdkContract["subscribe"];

  constructor(options: PatcherSdkOptions = {}) {
    const sdk = createNodePatcherSdk(withAmbientAppKey(options));
    this.browserHistory = sdk.browserHistory;
    this.environments = sdk.environments;
    this.files = sdk.files;
    this.guide = sdk.guide;
    this.hosts = sdk.hosts;
    this.plugins = sdk.plugins;
    this.projects = sdk.projects;
    this.providers = sdk.providers;
    this.skills = sdk.skills;
    this.status = sdk.status;
    this.system = sdk.system;
    this.terminals = sdk.terminals;
    this.theme = sdk.theme;
    this.threadSections = sdk.threadSections;
    this.threads = sdk.threads;
    this.subscribe = sdk.subscribe;
  }
}

export function createPatcherSdk(options: PatcherSdkOptions = {}): PatcherSdk {
  return new PatcherSdk(options);
}

/**
 * Resolve the app key the same way the base URL is resolved: from the ambient
 * environment, unless the caller named one.
 *
 * `/api/v1` and `/ws` refuse a request that identifies itself as nothing, and
 * this SDK's whole premise is `new PatcherSdk()` inside an agent's shell —
 * where the host daemon exports `PATCHER_APP_KEY` beside `PATCHER_SERVER_URL`.
 * Resolving one and not the other would leave every such script refused.
 *
 * Not done inside `createNodeTransport`: a plugin supplies its own `fetch` and
 * identifies itself with its own header pair, and wrapping that with the app's
 * key would hand a plugin the credential it is not meant to hold.
 */
function withAmbientAppKey(options: PatcherSdkOptions): PatcherSdkOptions {
  if (options.appKey !== undefined) return options;
  const appKey = resolveAppApiKey();
  return appKey === undefined ? options : { ...options, appKey };
}
