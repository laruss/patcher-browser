// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAppSettings, defaultExperiments } from "@patcher/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingHost } from "./OnboardingHost";

const mocks = vi.hoisted(() => ({
  useAnswerCliSkillsOffer: vi.fn(),
  reportInstallResults: vi.fn(),
  useCliSkillsStatus: vi.fn(),
  useCreateProject: vi.fn(),
  useHostProviderCliStatus: vi.fn(),
  usePrimaryHost: vi.fn(),
  useProviderCliInstallRunner: vi.fn(),
  useSetupCliSkills: vi.fn(),
  useSidebarNavigation: vi.fn(),
  useCliSkillsUpdateToast: vi.fn(),
  useSystemConfig: vi.fn(),
  useUpdateGeneralSettings: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useCliSkillsStatus: mocks.useCliSkillsStatus,
  useHostProviderCliStatus: mocks.useHostProviderCliStatus,
  useSystemConfig: mocks.useSystemConfig,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useAnswerCliSkillsOffer: mocks.useAnswerCliSkillsOffer,
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
vi.mock("./useCliSkillsUpdateToast", () => ({
  useCliSkillsUpdateToast: mocks.useCliSkillsUpdateToast,
}));
vi.mock("./OnboardingFlow", () => ({
  OnboardingFlow: () => <div>Onboarding flow</div>,
}));
vi.mock("./NewCliSkillsDialog", () => ({
  NewCliSkillsDialog: (props: {
    offer: { skills: string[] };
    onAccept: () => void;
    onDecline: () => void;
  }) => (
    <div>
      <span>{`New skill question for ${props.offer.skills.join(", ")}`}</span>
      <button type="button" onClick={props.onAccept}>
        Install it
      </button>
      <button type="button" onClick={props.onDecline}>
        Leave it
      </button>
    </div>
  ),
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
  cliSkillsOffer?: {
    skills: string[];
    machines: { hostName: string }[];
  } | null;
  cliSkillsUpdates?: { at: number; hostName: string }[];
  newOnboarding?: boolean;
  outsideAgentSetup?: "unasked" | "accepted" | "declined";
  primaryHostId?: string | null;
}) {
  return {
    data: {
      experiments: {
        ...defaultExperiments,
        newOnboarding: args.newOnboarding ?? false,
      },
      generalSettings: defaultAppSettings,
      outsideAgentSetup: args.outsideAgentSetup ?? "unasked",
      cliSkillsUpdates: args.cliSkillsUpdates ?? [],
      cliSkillsOffer: args.cliSkillsOffer ?? null,
      primaryHostId:
        args.primaryHostId === undefined ? "host-1" : args.primaryHostId,
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
  mocks.useAnswerCliSkillsOffer.mockReturnValue({
    isPending: false,
    isSuccess: false,
    mutate: vi.fn(),
    reset: vi.fn(),
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
      retryUnknown: true,
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
      retryUnknown: true,
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
        retryUnknown: true,
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
      retryUnknown: true,
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
      cliCommand: null,
    });
    mutate.mock.calls[1]?.[1]?.onSuccess?.({
      outsideAgentSetup: "declined",
      install: null,
      cliCommand: null,
    });
    expect(mocks.reportInstallResults).toHaveBeenCalledTimes(1);
    expect(mocks.reportInstallResults).toHaveBeenCalledWith(install);
  });

  it("stays up while the answer is being sent, though the config already says it was answered", () => {
    // The server records an accept and broadcasts before the install runs, so
    // the refetched config says `accepted` while the request is still open.
    mocks.useSetupCliSkills.mockReturnValue({
      isPending: true,
      isSuccess: false,
      mutate: vi.fn(),
    });
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ outsideAgentSetup: "accepted" }),
    );

    render(<OnboardingHost />);

    expect(screen.getByText(QUESTION)).toBeTruthy();
  });

  it("is not asked when the server names no primary machine, whatever the host list would guess", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ primaryHostId: null }),
    );
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));

    render(<OnboardingHost />);

    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(mocks.useCliSkillsStatus).toHaveBeenCalledWith({
      enabled: false,
      hostIds: ["host-1"],
      retryUnknown: true,
    });
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

describe("the note that the skills were kept current", () => {
  const updates = [{ at: 10, hostName: "Laptop" }];

  it("is held back while the question is up", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsUpdates: updates }),
    );
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));

    render(<OnboardingHost />);

    expect(mocks.useCliSkillsUpdateToast).toHaveBeenLastCalledWith({
      notices: updates,
      paused: true,
    });
  });

  it("is held back while onboarding is up", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsUpdates: updates, newOnboarding: true }),
    );

    render(<OnboardingHost />);

    expect(mocks.useCliSkillsUpdateToast).toHaveBeenLastCalledWith({
      notices: updates,
      paused: true,
    });
  });

  it("is held back while the read that decides whether to ask is still out", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsUpdates: updates }),
    );
    for (const status of [
      { data: undefined },
      primaryMachineStatus("unknown"),
    ]) {
      mocks.useCliSkillsStatus.mockReturnValue(status);

      render(<OnboardingHost />);

      expect(mocks.useCliSkillsUpdateToast).toHaveBeenLastCalledWith({
        notices: updates,
        paused: true,
      });
      cleanup();
    }
  });

  it("is let through once the read says there is nothing to ask", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsUpdates: updates }),
    );
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("installed"));

    render(<OnboardingHost />);

    expect(mocks.useCliSkillsUpdateToast).toHaveBeenLastCalledWith({
      notices: updates,
      paused: false,
    });
  });

  it("is let through when neither is on screen", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({
        cliSkillsUpdates: updates,
        outsideAgentSetup: "accepted",
      }),
    );

    render(<OnboardingHost />);

    expect(mocks.useCliSkillsUpdateToast).toHaveBeenLastCalledWith({
      notices: updates,
      paused: false,
    });
  });
});

describe("the question about a newly shipped skill", () => {
  const offer = {
    skills: ["patcher-notes"],
    machines: [{ hostName: "Laptop" }],
  };
  const NEW_SKILL_QUESTION = "New skill question for patcher-notes";

  it("is asked once nothing else is on screen", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsOffer: offer, outsideAgentSetup: "accepted" }),
    );

    render(<OnboardingHost />);

    expect(screen.getByText(NEW_SKILL_QUESTION)).toBeTruthy();
  });

  it("waits behind onboarding and behind the launch-time question", () => {
    mocks.useCliSkillsStatus.mockReturnValue(primaryMachineStatus("missing"));
    for (const config of [
      systemConfig({ cliSkillsOffer: offer, newOnboarding: true }),
      systemConfig({ cliSkillsOffer: offer }),
    ]) {
      mocks.useSystemConfig.mockReturnValue(config);

      render(<OnboardingHost />);

      expect(screen.queryByText(NEW_SKILL_QUESTION)).toBeNull();
      cleanup();
    }
  });

  it("waits while the read that decides the launch-time question is still out", () => {
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsOffer: offer }),
    );
    mocks.useCliSkillsStatus.mockReturnValue({ data: undefined });

    render(<OnboardingHost />);

    expect(screen.queryByText(NEW_SKILL_QUESTION)).toBeNull();
  });

  it("holds the note about updated skills back while it is up", () => {
    const updates = [{ at: 10, hostName: "Laptop" }];
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({
        cliSkillsOffer: offer,
        cliSkillsUpdates: updates,
        outsideAgentSetup: "accepted",
      }),
    );

    render(<OnboardingHost />);

    expect(mocks.useCliSkillsUpdateToast).toHaveBeenLastCalledWith({
      notices: updates,
      paused: true,
    });
  });

  it("sends the answer, and reports an install only when there was one", () => {
    const mutate = vi.fn();
    mocks.useAnswerCliSkillsOffer.mockReturnValue({
      isPending: false,
      isSuccess: false,
      mutate,
      reset: vi.fn(),
    });
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsOffer: offer, outsideAgentSetup: "accepted" }),
    );
    const install = { results: [] };

    render(<OnboardingHost />);
    fireEvent.click(screen.getByRole("button", { name: "Install it" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave it" }));

    // The names the window showed ride along, so the server cannot settle a
    // skill that appeared after the question was drawn.
    expect(mutate.mock.calls.map(([args]) => args)).toEqual([
      { answer: "accept", skills: ["patcher-notes"] },
      { answer: "decline", skills: ["patcher-notes"] },
    ]);
    mutate.mock.calls[0]?.[1]?.onSuccess?.({
      answered: ["patcher-notes"],
      install,
    });
    mutate.mock.calls[1]?.[1]?.onSuccess?.({
      answered: ["patcher-notes"],
      install: null,
    });
    expect(mocks.reportInstallResults).toHaveBeenCalledTimes(1);
    expect(mocks.reportInstallResults).toHaveBeenCalledWith(install);
  });

  // The server records the answer and says `config-changed` before the install
  // runs, so the offer is already gone while it is still installing. Resetting
  // a request that is still out would detach it: the question would close
  // mid-install and its per-machine outcome would never be reported.
  it("stays up while the answer is being sent, though the config already dropped it", () => {
    const reset = vi.fn();
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsOffer: offer, outsideAgentSetup: "accepted" }),
    );
    const view = render(<OnboardingHost />);
    expect(screen.getByText(NEW_SKILL_QUESTION)).toBeTruthy();

    mocks.useAnswerCliSkillsOffer.mockReturnValue({
      isPending: true,
      isSuccess: false,
      mutate: vi.fn(),
      reset,
    });
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsOffer: null, outsideAgentSetup: "accepted" }),
    );
    view.rerender(<OnboardingHost />);

    expect(screen.getByText(NEW_SKILL_QUESTION)).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();
  });

  it("forgets a settled answer once it no longer describes what is offered", () => {
    const reset = vi.fn();
    mocks.useAnswerCliSkillsOffer.mockReturnValue({
      data: { answered: ["patcher-notes"], install: null },
      isPending: false,
      isSuccess: true,
      mutate: vi.fn(),
      reset,
    });
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({
        cliSkillsOffer: {
          skills: ["patcher-tasks"],
          machines: [{ hostName: "Laptop" }],
        },
        outsideAgentSetup: "accepted",
      }),
    );

    render(<OnboardingHost />);

    expect(reset).toHaveBeenCalled();
  });

  it("goes away as soon as the answer lands", () => {
    mocks.useAnswerCliSkillsOffer.mockReturnValue({
      isPending: false,
      isSuccess: true,
      mutate: vi.fn(),
      reset: vi.fn(),
    });
    mocks.useSystemConfig.mockReturnValue(
      systemConfig({ cliSkillsOffer: offer, outsideAgentSetup: "accepted" }),
    );

    render(<OnboardingHost />);

    expect(screen.queryByText(NEW_SKILL_QUESTION)).toBeNull();
  });
});
