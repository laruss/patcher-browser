import { z } from "zod";
import {
  credentialListArgsSchema,
  credentialRequestArgsSchema,
  credentialMetadataSchema,
  credentialResultSchema,
  type PluginBrowserCredentials,
} from "@patcher/domain/protected-credentials";
export type RequestCredentials = (
  method: "list" | "request",
  args: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;
export function createPluginCredentials(args: {
  assertLive(): void;
  gate: { assert(permission: "credentials.manage", operation: string): void };
  request?: RequestCredentials;
}): PluginBrowserCredentials {
  async function call(
    method: "list" | "request",
    input: unknown,
    signal?: AbortSignal,
  ) {
    args.assertLive();
    args.gate.assert("credentials.manage", `browser.credentials.${method}`);
    const parsed = (
      method === "list" ? credentialListArgsSchema : credentialRequestArgsSchema
    ).safeParse(input);
    if (!parsed.success) throw new Error("Invalid credential request");
    if (!args.request) throw new Error("Protected credentials unavailable");
    const result = await args.request(method, parsed.data, signal);
    args.assertLive();
    return result;
  }
  return {
    list: async (input, options) =>
      z
        .array(credentialMetadataSchema)
        .parse(await call("list", input, options?.signal)),
    request: async (input, options) =>
      credentialResultSchema.parse(
        await call("request", input, options?.signal),
      ),
  };
}

export interface PluginBrowserHostCapabilities {
  requestCredentials?: RequestCredentials;
  requestBrowserCommand(args: {
    command: import("@patcher/domain").BrowserCommand;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<import("@patcher/domain").BrowserCommandValue>;
  getBrowserHostStatus(): { connected: boolean; hostCount: number };
}
