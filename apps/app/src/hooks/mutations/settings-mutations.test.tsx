// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemConfigResponse } from "@patcher/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
  type AppKeybindingOverrides,
  type AppKeybindings,
} from "@patcher/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  systemCliSkillsQueryKey,
  systemConfigQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
} from "../queries/query-keys";
import {
  useSetupCliSkills,
  useUpdateGeneralSettings,
  useUpdateKeyboardSettings,
} from "./settings-mutations";

vi.mock("@/lib/sdk", () => {
  return {
    sdk: {
      system: {
        setupCliSkills: vi.fn(),
        updateGeneralSettings: vi.fn(),
        updateKeyboardSettings: vi.fn(),
      },
    },
  };
});

const defaultKeybindings: AppKeybindings = [
  {
    command: "thread.new",
    desktopOnly: false,
    shortcut: {
      key: "n",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
];

function systemConfig(): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: defaultKeybindings,
    defaultKeybindings,
    keybindingOverrides: [],
    experiments: defaultExperiments,
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false, timelineWindowEventBudget: 1_500 },
    hostDaemonPort: null,
    serverUrl: "http://localhost:38986",
    primaryHostId: null,
    primaryHostPlatform: null,
    outsideAgentSetup: "unasked",
    cliSkillsUpdates: [],
    cliSkillsOffer: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/patcher-test",
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("general settings mutation", () => {
  it("invalidates config and timeline projections after visibility changes", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const configKey = systemConfigQueryKey();
    const timelineKey = threadTimelineQueryKey("thread-1");
    const summaryKey = threadTimelineTurnSummaryDetailsQueryKey({
      threadId: "thread-1",
      turnId: "turn-1",
      sourceSeqStart: 1,
      sourceSeqEnd: 2,
    });
    queryClient.setQueryData(configKey, systemConfig());
    queryClient.setQueryData(timelineKey, {});
    queryClient.setQueryData(summaryKey, {});
    const nextSettings = {
      ...defaultAppSettings,
      showUnhandledProviderEvents: true,
    };
    vi.mocked(sdk.system.updateGeneralSettings).mockResolvedValue(nextSettings);
    const { result } = renderHook(() => useUpdateGeneralSettings(), {
      wrapper,
    });

    act(() => result.current.mutate(nextSettings));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(configKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
  });
});

describe("CLI skills setup mutation", () => {
  it("refreshes the config and every read of the skills' state, whichever machines it asked", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const configKey = systemConfigQueryKey();
    const everyMachineKey = systemCliSkillsQueryKey();
    const primaryMachineKey = systemCliSkillsQueryKey(["host-1"]);
    queryClient.setQueryData(configKey, systemConfig());
    queryClient.setQueryData(everyMachineKey, { machines: [] });
    queryClient.setQueryData(primaryMachineKey, { machines: [] });
    vi.mocked(sdk.system.setupCliSkills).mockResolvedValue({
      outsideAgentSetup: "declined",
      install: null,
    });
    const { result } = renderHook(() => useSetupCliSkills(), { wrapper });

    act(() => result.current.mutate({ answer: "decline" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(configKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(everyMachineKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(primaryMachineKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("refreshes the config when the request fails too, since an accept is recorded before its install", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const configKey = systemConfigQueryKey();
    queryClient.setQueryData(configKey, systemConfig());
    vi.mocked(sdk.system.setupCliSkills).mockRejectedValue(
      new Error("The built-in Patcher CLI skill is unavailable on this server"),
    );
    const { result } = renderHook(() => useSetupCliSkills(), { wrapper });

    act(() => result.current.mutate({ answer: "accept" }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryState(configKey)?.isInvalidated).toBe(true);
  });
});

describe("keyboard settings mutation", () => {
  it("updates resolved system config before the request completes", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
    let resolveRequest: (overrides: AppKeybindingOverrides) => void = () => {};
    vi.mocked(sdk.system.updateKeyboardSettings).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const overrides: AppKeybindingOverrides = [
      {
        command: "thread.new",
        shortcut: {
          key: "u",
          mod: true,
          meta: false,
          control: false,
          alt: false,
          shift: true,
        },
      },
    ];
    const { result } = renderHook(() => useUpdateKeyboardSettings(), {
      wrapper,
    });

    act(() => result.current.mutate(overrides));
    await waitFor(() => {
      expect(
        queryClient.getQueryData<SystemConfigResponse>(systemConfigQueryKey())
          ?.keybindings[0]?.shortcut,
      ).toMatchObject({ key: "u", shift: true });
    });

    act(() => resolveRequest(overrides));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores resolved system config when the request fails", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
    vi.mocked(sdk.system.updateKeyboardSettings).mockRejectedValue(
      new Error("write failed"),
    );
    const { result } = renderHook(() => useUpdateKeyboardSettings(), {
      wrapper,
    });

    act(() =>
      result.current.mutate([{ command: "thread.new", shortcut: null }]),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    const restored = queryClient.getQueryData<SystemConfigResponse>(
      systemConfigQueryKey(),
    );
    expect(restored?.keybindingOverrides).toEqual([]);
    expect(restored?.keybindings).toEqual(defaultKeybindings);
  });
});
