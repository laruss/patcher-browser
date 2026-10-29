import type { PluginBrowserCredentials } from "@patcher/domain/protected-credentials";
export function fakeCredentials(
  assertLive: () => void,
  gate: { assert(permission: "credentials.manage", operation: string): void },
): PluginBrowserCredentials {
  const deny = async () => {
    assertLive();
    gate.assert("credentials.manage", "browser.credentials");
    throw new Error("Protected credentials require a native desktop host");
  };
  return { list: deny, request: deny };
}

export function fakeNativeBrowserCapabilities(
  assertLive: () => void,
  gate: { assert(permission: "credentials.manage", operation: string): void },
  connected: () => boolean,
) {
  return {
    credentials: fakeCredentials(assertLive, gate),
    getStatus: () => ({
      connected: connected(),
      windowCount: connected() ? 1 : 0,
    }),
  };
}
