import {
  createNodePatcherSdk,
  type PatcherSdk,
  type PatcherSdkContext,
} from "@patcher/sdk/node";

export interface CreateCliPatcherSdkOptions {
  context?: PatcherSdkContext;
}

export function cliFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, init);
}

export function createCliPatcherSdk(
  baseUrl: string,
  options: CreateCliPatcherSdkOptions = {},
): PatcherSdk {
  return createNodePatcherSdk({
    baseUrl,
    context: options.context,
    fetch: cliFetch,
  });
}
