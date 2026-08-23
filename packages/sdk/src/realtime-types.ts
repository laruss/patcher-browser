import type { ChangedMessage } from "@patcher/domain";

export type PatcherRealtimeUnsubscribe = () => void;

export type PatcherRealtimeEventName =
  | "thread:changed"
  | "project:changed"
  | "environment:changed"
  | "host:changed"
  | "system:changed"
  | "system:config-changed"
  | "realtime:connection";

export type ThreadRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "thread" }
>;
export type ProjectRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "project" }
>;
export type EnvironmentRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "environment" }
>;
export type HostRealtimeEvent = Extract<ChangedMessage, { entity: "host" }>;
export type SystemRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "system" }
>;

export type PatcherRealtimeConnectionState =
  | "connecting"
  | "connected"
  | "disconnected";

export interface PatcherRealtimeConnectionEvent {
  reconnectDelayMs: number | null;
  reconnected: boolean;
  state: PatcherRealtimeConnectionState;
}

/**
 * Entity-changed events are delivered as one shared object to every matching
 * listener; their payload types are readonly so a listener cannot mutate what
 * the next listener receives.
 */
export interface PatcherRealtimeEventMap {
  "thread:changed": ThreadRealtimeEvent;
  "project:changed": ProjectRealtimeEvent;
  "environment:changed": EnvironmentRealtimeEvent;
  "host:changed": HostRealtimeEvent;
  "system:changed": SystemRealtimeEvent;
  "system:config-changed": SystemRealtimeEvent;
  "realtime:connection": PatcherRealtimeConnectionEvent;
}

export type PatcherRealtimeCallback<TEventName extends PatcherRealtimeEventName> = (
  event: PatcherRealtimeEventMap[TEventName],
) => void;

export interface ThreadRealtimeSubscribeArgs {
  callback: PatcherRealtimeCallback<"thread:changed">;
  event: "thread:changed";
  threadId?: string;
}

export interface ProjectRealtimeSubscribeArgs {
  callback: PatcherRealtimeCallback<"project:changed">;
  event: "project:changed";
  projectId?: string;
}

export interface EnvironmentRealtimeSubscribeArgs {
  callback: PatcherRealtimeCallback<"environment:changed">;
  environmentId?: string;
  event: "environment:changed";
}

export interface HostRealtimeSubscribeArgs {
  callback: PatcherRealtimeCallback<"host:changed">;
  event: "host:changed";
  hostId?: string;
}

export interface SystemRealtimeSubscribeArgs {
  callback: PatcherRealtimeCallback<"system:changed">;
  event: "system:changed";
}

export interface SystemConfigRealtimeSubscribeArgs {
  callback: PatcherRealtimeCallback<"system:config-changed">;
  event: "system:config-changed";
}

/**
 * Connection listeners are pure observers — they never open or hold the
 * socket. A listener registered while a socket already exists receives the
 * latest connection event as a snapshot on the next microtask, so a status
 * UI mounted after connect still learns the current state.
 */
export interface RealtimeConnectionSubscribeArgs {
  callback: PatcherRealtimeCallback<"realtime:connection">;
  event: "realtime:connection";
}

export type PatcherRealtimeSubscribeArgsUnion =
  | ThreadRealtimeSubscribeArgs
  | ProjectRealtimeSubscribeArgs
  | EnvironmentRealtimeSubscribeArgs
  | HostRealtimeSubscribeArgs
  | SystemRealtimeSubscribeArgs
  | SystemConfigRealtimeSubscribeArgs
  | RealtimeConnectionSubscribeArgs;

export type PatcherRealtimeSubscribeArgs<
  TEventName extends PatcherRealtimeEventName = PatcherRealtimeEventName,
> = Extract<PatcherRealtimeSubscribeArgsUnion, { event: TEventName }>;

export interface PatcherRealtime {
  subscribe<TEventName extends PatcherRealtimeEventName>(
    args: PatcherRealtimeSubscribeArgs<TEventName>,
  ): PatcherRealtimeUnsubscribe;
}
