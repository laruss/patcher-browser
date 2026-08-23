import type { PatcherSdkContext, PatcherSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  context: PatcherSdkContext;
  transport: PatcherSdkTransport;
}

type SignalRequestOptions = { init: { signal: AbortSignal } };

export function signalRequestArgs(
  signal: AbortSignal | undefined,
): [] | [SignalRequestOptions] {
  return signal === undefined ? [] : [{ init: { signal } }];
}
