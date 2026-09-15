// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAppSettings, defaultExperiments } from "@patcher/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingHost } from "./OnboardingHost";

const mocks = vi.hoisted(() => ({
  reportInstallResults: vi.fn(),
  useCliSkillsStatus: vi.fn(),
  useCreateProject: vi.fn(),
  useHostProviderCliStatus: vi.fn(),
  usePrimaryHost: vi.fn(),
  useProviderCliInstallRunner: vi.fn(),
  useSetupCliSkills: vi.fn(),
  useSidebarNavigation: vi.fn(),
  useSystemConfig: vi.fn(),
  useUpdateGeneralSettings: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useCliSkillsStatus: mocks.useCliSkillsStatus,
  useHostProviderCliStatus: mocks.useHostProviderCliStatus,
  useSystemConfig: mocks.useSystemConfig,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useSetupCliSkills: mocks.useSetupCliSkills,
  useUpdateGeneralSettings: mocks.useUpdateGeneralSettings,
}));
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: mocks.useCreateProject,
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  usePrimaryHost: mocks.usePrimaryHost,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: mocks.useSidebarNavigation,
}));
vi.mock("@/components/provider-cli/provider-cli-install", () => ({
  buildProviderCliIssue: vi.fn(),
  hasProviderCliAction: vi.fn(),
  providerCliEntries: vi.fn(() => []),
  useProviderCliInstallRunner: mocks.useProviderCliInstallRunner,
}));
vi.mock("@/components/provider-cli/provider-cli-install-store", () => ({
  providerCliJobKey: vi.fn(() => "job"),
}));
vi.mock("@/components/settings/cli-skills-install-results", () => ({
  reportInstallResults: mocks.reportInstallResults,
}));
vi.mock("./OnboardingFlow", () => ({
  OnboardingFlow: () => <div>Onboarding flow</div>,
}));
vi.mock("./OutsideAgentSetupDialog", () => ({
  OutsideAgentSetupDialog: (props: {
    hostName: string;
    onAccept: () => void;
    onDecline: () => void;
  }) => (
    <div>
      <span>{`Setup question for ${props.hostName}`}</span>
      <button type="button" onClick={props.onAccept}>
        Set up
      </button>
      <button type="button" onClick={props.onDecline}>
        Not now
      </button>
    </div>
  ),
}));

const QUESTION = "Setup question for Laptop";

function systemConfig(args: {
  newOnboarding?: boolean;
  outsideAgentSetup?: "unasked" | "accepted" | "declined";
}) {
  return {
    data: {
      experiments: {
        ...defaultExperiments,
        newOnboarding: args.newOnboarding ?? false,
      },
      generalSettings: defaultAppSettings,
      outsideAgentSetup: args.outsideAgentSetup ?? "unasked",
    },
  };
}

function primaryMachineStatus(
  status: "installed" | "outdated" | "missing" | "unknown",
) {
  return {
    data: { machines: [{ hostId: "host-1", hostName: "Laptop", status }] },
  };
}

beforeEach(() => {
  mocks.useCliSkillsStatus.mockReturnValue({ data: undefined });
  mocks.useCreateProject.mockReturnValue({ mutateAsync: vi.fn() });
  mocks.useHostProviderCliStatus.mockReturnValue({ data: undefined });
  mocks.usePrimaryHost.mockReturnValue({
    id: "host-1",
    name: "Laptop",
    status: "connected",
  });
  mocks.useProviderCliInstallRunner.mockReturnValue({
    queuedJobKeys: new Set(),
    runningJobKey: null,
    startInstall: vi.fn(),
  });
  mocks.useSetupCliSkills.mockReturnValue({
    isPending: false,
    isSuccess: false,
    mutate: vi.fn(),
  });
  mocks.useSidebarNavigation.mockReturnValue({ data: { projects: [] } });
  mocks.useUpdateGeneralSettings.mockReturnValue({ mutate: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingHost", () => {
  it("does not show or run provider checks while the experiment is off", () => {
    mocks.useSystemConfig.mockReturnValue({
      data: {
        experiments: defaultExperiments,
        generalSettings: defaultAppSettings,
      },
    });

    render(<OnboardingHost />);

    expect(screen.queryByText("Onboarding flow")).toBeNull();
    expect(mocks.useHostProviderCliStatus).toHaveBeenCalledWith({
      enabled: false,
      hostId: "host-1",
    });
  });

  it("shows onboarding when the experiment is on and setup is incomplete", () => {
    mocks.useSystemConfig.mockReturnValue({
      data: {
        experiments: { ...defaultExperiments, newOnboarding: true },
        generalSettings: defaultAppSettings,
      },
    });

    render(<OnboardingHost />);

    expect(screen.getByText("Onboarding flow")).toBeTruthy();
    expect(mocks.useHostProviderCliStatus).toHaveBeenCalledWith({
      enabled: true,
      hostId: "host-1",
    });
  });
});

describe("the question about agents outside Patcher", () => {
  it("asks an unanswered install whose primary machine holds none of the skills", () => {
    mocks.useSystemConfig.mockReturnValue(systemConfig({}));
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));

    render(<OnboardingHost />);

    expect(screen.getByText(QUESTION)).toBeTruthy();
    // One machine asked, not every enrolled one.
    expect(mocks.useCliSkillsStatus).toHaveBeenCalledWith({
      enabled: true,
      hostIds: ["host-1"],
    });
  });

  it("is not asked over onboarding, and reads nothing while onboarding shows", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ newOnboarding: true }),
    );
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));

    render(<OnboardingHost />);

    expect(screen.getByText("Onboarding flow")).toBeTruthy();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(mocks.useCliSkillsStatus).toHaveBeenCalledWith({
      enabled: false,
      hostIds: ["host-1"],
    });
  });

  it("is not asked again once answered either way", () => {
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));
    for (const answer of ["accepted", "declined"] as const) {
      mocks.useSystemConfig.mockReturnValue(
        systemConfig({ outsideAgentSetup: answer }),
      );

      render(<OnboardingHost />);

      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(mocks.useCliSkillsStatus).toHaveBeenLastCalledWith({
        enabled: false,
        hostIds: ["host-1"],
      });
      cleanup();
    }
  });

  it("is not asked of a machine that has a copy, or whose state is not known yet", () => {
    mocks.useSystemConfig.mockReturnValue(systemConfig({}));
    for (const status of [
      primaryMachineStatus("installed"),
      primaryMachineStatus("outdated"),
      primaryMachineStatus("unknown"),
      { data: undefined },
    ]) {
      mocks.useCliSkillsStatus.mockReturnValue(status);

      render(<OnboardingHost />);

      expect(screen.queryByText(QUESTION)).toBeNull();
      cleanup();
    }
  });

  it("waits for the primary machine to connect, since answering yes installs there", () => {
    mocks.useSystemConfig.mockReturnValue(systemConfig({}));
    mocks.usePrimaryHost.mockReturnValue({
      id: "host-1",
      name: "Laptop",
      status: "disconnected",
    });
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));

    render(<OnboardingHost />);

    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(mocks.useCliSkillsStatus).toHaveBeenCalledWith({
      enabled: false,
      hostIds: ["host-1"],
    });
  });

  it("sends the person's answer, and reports the install only when there was one", () => {
    const mutate = vi.fn();
    mocks.useSetupCliSkills.mockReturnValue({
      isPending: false,
      isSuccess: false,
      mutate,
    });
    mocks.useSystemConfig.mockReturnValue(systemConfig({}));
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));
    const install = { results: [] };

    render(<OnboardingHost />);
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(mutate.mock.calls.map(([args]) => args)).toEqual([
      { answer: "accept" },
      { answer: "decline" },
    ]);
    mutate.mock.calls[0]?.[1]?.onSuccess?.({
      outsideAgentSetup: "accepted",
      install,
    });
    mutate.mock.calls[1]?.[1]?.onSuccess?.({
      outsideAgentSetup: "declined",
      install: null,
    });
    expect(mocks.reportInstallResults).toHaveBeenCalledTimes(1);
    expect(mocks.reportInstallResults).toHaveBeenCalledWith(install);
  });

  it("goes away as soon as the answer lands, before the config catches up", () => {
    mocks.useSetupCliSkills.mockReturnValue({
      isPending: false,
      isSuccess: true,
      mutate: vi.fn(),
    });
    mocks.useSystemConfig.mockReturnValue(systemConfig({}));
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));

    render(<OnboardingHost />);

    expect(screen.queryByText(QUESTION)).toBeNull();
  });
});
