import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { PatcherPluginApi } from "../index.js";

type ExpectedPatcherPluginApiKey =
  | "agents"
  | "background"
  | "browser"
  | "cli"
  | "events"
  | "http"
  | "log"
  | "onDispose"
  | "pluginId"
  | "realtime"
  | "rpc"
  | "sdk"
  | "server"
  | "settings"
  | "status"
  | "storage"
  | "ui";

const EXPECTED_BACKEND_ROOT_TYPE_EXPORTS = [
  "PatcherPluginApi",
  "PluginAgents",
  "PluginAgentConfiguration",
  "PluginAgentConfigurationContext",
  "PluginAgentToolContentPart",
  "PluginAgentToolContext",
  "PluginAgentToolExperimentalStatusLabels",
  "PluginAgentToolRegistrationBase",
  "PluginAgentToolResult",
  "PluginAgentToolSelection",
  "PluginBackground",
  "PluginBrowser",
  "PluginBrowserAction",
  "PluginBrowserAuthChallenge",
  "PluginBrowserAuthCredentials",
  "PluginBrowserAuthProvider",
  "PluginBrowserCallOptions",
  "PluginBrowserConsoleEntry",
  "PluginBrowserControl",
  "PluginBrowserCookie",
  "PluginBrowserCookieInput",
  "PluginBrowserContextMenuContext",
  "PluginBrowserContextMenuItemRegistration",
  "PluginBrowserContextMenuWhen",
  "PluginBrowserCookies",
  "PluginBrowserDownload",
  "PluginBrowserDownloadHandler",
  "PluginBrowserDownloadState",
  "PluginBrowserErrorCode",
  "PluginBrowserEvaluated",
  "PluginBrowserExternalLink",
  "PluginBrowserExternalLinkDecision",
  "PluginBrowserExternalLinkHandler",
  "PluginBrowserFindActionRegistration",
  "PluginBrowserFindContext",
  "PluginBrowserHistoryFilter",
  "PluginBrowserHistoryRewrite",
  "PluginBrowserHistoryVisit",
  "PluginBrowserKeyModifier",
  "PluginBrowserLog",
  "PluginBrowserNavigation",
  "PluginBrowserNetworkEntry",
  "PluginBrowserPage",
  "PluginBrowserPageSnapshot",
  "PluginBrowserPageState",
  "PluginBrowserPdf",
  "PluginBrowserPdfDocument",
  "PluginBrowserPdfTextProvider",
  "PluginBrowserRecording",
  "PluginBrowserRoute",
  "PluginBrowserRouteState",
  "PluginBrowserRoutes",
  "PluginBrowserScreenshot",
  "PluginBrowserStatus",
  "PluginBrowserStorage",
  "PluginBrowserStorageArea",
  "PluginBrowserStorageItem",
  "PluginBrowserStorageItems",
  "PluginBrowserStorageWrite",
  "PluginBrowserPageScriptRegistration",
  "PluginBrowserPageStyleRegistration",
  "PluginBrowserSearchEngineRegistration",
  "PluginBrowserSiteInfoContext",
  "PluginBrowserSiteInfoProviderRegistration",
  "PluginBrowserSiteInfoRow",
  "PluginBrowserNewTabContext",
  "PluginBrowserNewTabRow",
  "PluginBrowserNewTabWidgetRegistration",
  "PluginBrowserTab",
  "PluginBrowserTabActionContext",
  "PluginBrowserTabActionRegistration",
  "PluginBrowserTabs",
  "PluginBrowserToolbarContext",
  "PluginBrowserToolbarItemRegistration",
  "PluginBrowserToolbarState",
  "PluginBrowserTrace",
  "PluginBrowserTraceStep",
  "PluginBrowserVideo",
  "PluginCli",
  "PluginCliCommandInfo",
  "PluginCliContext",
  "PluginCliExecutionResult",
  "PluginCliOutputLimitError",
  "PluginCliRegistration",
  "PluginCliResult",
  "PluginCommandRegistration",
  "PluginEvents",
  "PluginHttp",
  "PluginHttpAuthMode",
  "PluginHttpHandler",
  "PluginInteractionCancelReason",
  "PluginInteractionRequest",
  "PluginInteractionResult",
  "PluginKeybinding",
  "PluginKeybindingShortcut",
  "PluginKvStorage",
  "PluginLogger",
  "PluginMentionItem",
  "PluginMentionProviderRegistration",
  "PluginMentionSearchContext",
  "PluginMentionTrigger",
  "PluginOmniboxAction",
  "PluginOmniboxProviderRegistration",
  "PluginOmniboxRunContext",
  "PluginOmniboxRunResult",
  "PluginOmniboxSuggestContext",
  "PluginOmniboxSuggestion",
  "PluginPageScriptApi",
  "PluginRealtime",
  "PluginRpc",
  "PluginServerApi",
  "PluginSettingDescriptor",
  "PluginSettingDescriptors",
  "PluginSettingValue",
  "PluginSettings",
  "PluginSettingsHandle",
  "PluginSettingsValues",
  "PluginStatusApi",
  "PluginStorage",
  "PluginThreadEventHandler",
  "PluginThreadEventName",
  "PluginThreadEventPayloads",
  "PluginUi",
] as const;

const EXPECTED_BACKEND_ROOT_VALUE_EXPORTS = [
  "PLUGIN_CLI_OUTPUT_MAX_BYTES",
] as const;

const EXPECTED_RPC_ROOT_TYPE_EXPORTS = [
  "PluginRpcCallArgs",
  "PluginRpcContract",
  "PluginRpcError",
  "PluginRpcErrorCode",
  "PluginRpcHandlers",
  "PluginRpcIssuePathSegment",
  "PluginRpcMethodContract",
  "PluginRpcResult",
  "PluginRpcValidationIssue",
  "StandardSchemaV1",
  "StandardSchemaV1InferInput",
  "StandardSchemaV1InferOutput",
  "StandardSchemaV1Issue",
  "StandardSchemaV1Result",
] as const;

const EXPECTED_RPC_ROOT_VALUE_EXPORTS = ["defineRpcContract"] as const;

function namesFromMatches(source: string, pattern: RegExp): string[] {
  return Array.from(source.matchAll(pattern), (match) => match[1]).sort();
}

function rootExportNames(
  declarations: string,
  kind: "type" | "value",
): Set<string> {
  const prefix = kind === "type" ? "export type" : "export";
  const match = declarations.match(
    new RegExp(`^${prefix} \\{ ([^}]+) \\};$`, "mu"),
  );

  if (kind === "value" && match === null) return new Set();
  expect(match, `${prefix} declaration`).not.toBeNull();
  return new Set(match?.[1].split(", ") ?? []);
}

describe("backend plugin SDK public surface", () => {
  it("snapshots every PatcherPluginApi root member", () => {
    expectTypeOf<
      keyof PatcherPluginApi
    >().toEqualTypeOf<ExpectedPatcherPluginApiKey>();
  });

  it("keeps every backend contract export in the root declaration bundle", async () => {
    const [backendContract, declarations] = await Promise.all([
      readFile(new URL("../backend-contract.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../../bundled-types/patcher-plugin-sdk.d.ts", import.meta.url),
        "utf8",
      ),
    ]);
    const declaredBackendTypes = namesFromMatches(
      backendContract,
      /^export (?:interface|type) ([A-Za-z0-9_]+)/gmu,
    );
    const declaredBackendValues = namesFromMatches(
      backendContract,
      /^export (?:class|const|function) ([A-Za-z0-9_]+)/gmu,
    );
    const rootTypeExports = rootExportNames(declarations, "type");
    const rootValueExports = rootExportNames(declarations, "value");

    expect(declaredBackendTypes).toEqual(
      [...EXPECTED_BACKEND_ROOT_TYPE_EXPORTS].sort(),
    );
    expect(declaredBackendValues).toEqual(EXPECTED_BACKEND_ROOT_VALUE_EXPORTS);
    for (const exportName of EXPECTED_BACKEND_ROOT_TYPE_EXPORTS) {
      expect(rootTypeExports.has(exportName), exportName).toBe(true);
    }
    for (const exportName of EXPECTED_BACKEND_ROOT_VALUE_EXPORTS) {
      expect(rootValueExports.has(exportName), exportName).toBe(true);
    }
  });

  it("keeps every rpc contract export in the root declaration bundle", async () => {
    const [rpcContract, declarations] = await Promise.all([
      readFile(new URL("../rpc-contract.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../../bundled-types/patcher-plugin-sdk.d.ts", import.meta.url),
        "utf8",
      ),
    ]);
    const declaredTypes = namesFromMatches(
      rpcContract,
      /^export (?:interface|type) ([A-Za-z0-9_]+)/gmu,
    );
    const declaredValues = namesFromMatches(
      rpcContract,
      /^export (?:class|const|function) ([A-Za-z0-9_]+)/gmu,
    );
    expect(declaredTypes).toEqual([...EXPECTED_RPC_ROOT_TYPE_EXPORTS].sort());
    expect(declaredValues).toEqual([...EXPECTED_RPC_ROOT_VALUE_EXPORTS]);

    const rootTypeExports = rootExportNames(declarations, "type");
    const rootValueExports = rootExportNames(declarations, "value");
    for (const exportName of EXPECTED_RPC_ROOT_TYPE_EXPORTS) {
      expect(rootTypeExports.has(exportName), exportName).toBe(true);
    }
    for (const exportName of EXPECTED_RPC_ROOT_VALUE_EXPORTS) {
      expect(rootValueExports.has(exportName), exportName).toBe(true);
    }
  });
});
