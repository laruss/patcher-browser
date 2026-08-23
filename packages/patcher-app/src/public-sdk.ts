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
    const sdk = createNodePatcherSdk(options);
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
