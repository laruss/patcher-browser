import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, configureWebAuthn: vi.fn() },
  touchId: vi.fn(() => true),
  command: vi.fn(),
}));
vi.mock("electron", () => ({
  app: mocks.app,
  systemPreferences: { canPromptTouchID: mocks.touchId },
}));
vi.mock("node:child_process", () => ({ execFile: mocks.command }));
import {
  configureNativeWebAuthn,
  verifiedWebAuthnGroup,
} from "../src/native-webauthn.js";

const group = "TEAMID1234.app.patcher.desktop.webauthn";
const signature =
  "Identifier=app.patcher.desktop\nAuthority=Developer ID Application: Fixture\nTeamIdentifier=TEAMID1234\n";
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.app.isPackaged = true;
  mocks.touchId.mockReturnValue(true);
  mocks.command.mockImplementation((_file, args, _options, callback) => {
    queueMicrotask(() =>
      callback(
        null,
        args.includes("--entitlements")
          ? "<plist>fixture</plist>"
          : args.includes("json")
            ? JSON.stringify({ "keychain-access-groups": [group] })
            : "",
        args.includes("--verbose=4") ? signature : "",
      ),
    );
    return { stdin: { on: vi.fn(), end: vi.fn() } };
  });
});
afterEach(() => vi.restoreAllMocks());
it("requires the actual team, bundle, certificate and exact effective access group", () => {
  const entitlements = { "keychain-access-groups": [group] };
  expect(
    verifiedWebAuthnGroup(signature, entitlements, "app.patcher.desktop"),
  ).toBe(group);
  for (const changed of [
    signature + "Signature=adhoc\n",
    signature.replace("TEAMID1234", "not set"),
    signature.replace("Authority=Developer ID Application: Fixture\n", ""),
  ])
    expect(
      verifiedWebAuthnGroup(changed, entitlements, "app.patcher.desktop"),
    ).toBeNull();
  expect(
    verifiedWebAuthnGroup(
      signature,
      entitlements,
      "app.patcher.desktop.nightly",
    ),
  ).toBeNull();
  for (const changed of [
    null,
    {},
    { "keychain-access-groups": group },
    { "keychain-access-groups": ["TEAMID1234.*"] },
    { "keychain-access-groups": [group.replace("TEAMID1234", "OTHER12345")] },
  ])
    expect(
      verifiedWebAuthnGroup(signature, changed, "app.patcher.desktop"),
    ).toBeNull();
});
it("verifies the app and effective entitlements before configuring native WebAuthn", async () => {
  expect(await configureNativeWebAuthn("app.patcher.desktop")).toBe(true);
  expect(
    mocks.command.mock.calls.map(([file, args]) => [file, args.slice(0, 2)]),
  ).toEqual([
    ["/usr/bin/codesign", ["--display", "--verbose=4"]],
    ["/usr/bin/codesign", ["--display", "--entitlements"]],
    ["/usr/bin/plutil", ["-convert", "json"]],
    ["/usr/bin/codesign", ["--verify", "--strict"]],
  ]);
  expect(mocks.command.mock.calls[3]![1]).toContain("-R=anchor apple generic");
  expect(mocks.command.mock.calls[1]![1]).toContain("--xml");
  expect(mocks.app.configureWebAuthn).toHaveBeenCalledExactlyOnceWith({
    touchID: { keychainAccessGroup: group, promptReason: "sign in to $1" },
  });
});
it("keeps dev, missing hardware, wrong group and failed signature unsupported", async () => {
  mocks.app.isPackaged = false;
  expect(await configureNativeWebAuthn("app.patcher.desktop")).toBe(false);
  mocks.app.isPackaged = true;
  mocks.touchId.mockReturnValue(false);
  expect(await configureNativeWebAuthn("app.patcher.desktop")).toBe(false);
  expect(mocks.command).not.toHaveBeenCalled();
  mocks.touchId.mockReturnValue(true);
  expect(await configureNativeWebAuthn("app.patcher.desktop.nightly")).toBe(
    false,
  );
  mocks.command.mockImplementation((_file, _args, _options, callback) => {
    queueMicrotask(() => callback(new Error("invalid signature"), "", ""));
    return { stdin: { on: vi.fn(), end: vi.fn() } };
  });
  expect(await configureNativeWebAuthn("app.patcher.desktop")).toBe(false);
  expect(mocks.app.configureWebAuthn).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith(
    "Native Touch ID passkey signature check failed:",
    "invalid signature",
  );
});
it("skips resource verification and entitlement parsing for ad-hoc builds", async () => {
  mocks.command.mockImplementation((_file, _args, _options, callback) => {
    queueMicrotask(() =>
      callback(null, "", "Identifier=app.patcher.desktop\nSignature=adhoc\n"),
    );
    return { stdin: { on: vi.fn(), end: vi.fn() } };
  });
  expect(await configureNativeWebAuthn("app.patcher.desktop")).toBe(false);
  expect(mocks.command).toHaveBeenCalledOnce();
  expect(mocks.command.mock.calls[0]![1]).toContain("--display");
  expect(mocks.app.configureWebAuthn).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
});
it("reports native configuration errors separately from unavailable signing", async () => {
  mocks.app.configureWebAuthn.mockImplementationOnce(() => {
    throw new Error("configuration rejected");
  });
  expect(await configureNativeWebAuthn("app.patcher.desktop")).toBe(false);
  expect(console.warn).toHaveBeenCalledWith(
    "Native Touch ID passkey configuration failed:",
    "configuration rejected",
  );
});
it("rejects an invalid resource seal even when signature metadata and group match", async () => {
  const readSignature = mocks.command.getMockImplementation()!;
  mocks.command.mockImplementation((file, args, options, callback) => {
    if (!args.includes("--verify"))
      return readSignature(file, args, options, callback);
    queueMicrotask(() => callback(new Error("invalid resource seal"), "", ""));
    return { stdin: { on: vi.fn(), end: vi.fn() } };
  });
  expect(await configureNativeWebAuthn("app.patcher.desktop")).toBe(false);
  expect(mocks.app.configureWebAuthn).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith(
    "Native Touch ID passkey signature check failed:",
    "invalid resource seal",
  );
});
