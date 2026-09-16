import type {
  AppKeybindingOverrides,
  AppSettings,
  Experiments,
} from "@patcher/domain";
import type {
  DiscoverReposResult,
  ProviderUsageResponse,
} from "@patcher/host-daemon-contract";
import type {
  SystemAttentionResponse,
  SystemConfigReloadResponse,
  SystemConfigResponse,
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
  SystemBrowserAccessGrantCreateRequest,
  SystemBrowserAccessGrantCreateResponse,
  SystemBrowserAccessGrantListResponse,
  SystemBrowserAccessRequestCreateRequest,
  SystemBrowserAccessRequestCreateResponse,
  SystemBrowserAccessRequestDecideRequest,
  SystemBrowserAccessRequestListResponse,
  SystemBrowserAccessRequestOutcomeResponse,
  SystemBrowserExternalAccessRequest,
  SystemBrowserExternalAccessResponse,
  SystemCliSkillsOfferRequest,
  SystemCliSkillsSetupRequest,
  SystemCliSkillsOfferResponse,
  SystemCliSkillsSetupResponse,
  SystemCliSkillsStatusResponse,
  SystemCliCommandStatusResponse,
  SystemInstallCliCommandRequest,
  SystemInstallCliCommandResponse,
  SystemInstallCliSkillsRequest,
  SystemInstallCliSkillsResponse,
  OnboardingAgentOverview,
  OnboardingTelemetryEvent,
  SystemProvidersQuery,
  SystemOnboardingReposQuery,
  SystemUsageLimitsQuery,
  SystemVersionQuery,
  SystemVersionResponse,
  SystemVoiceTranscriptionResponse,
} from "@patcher/server-contract";
import { systemVoiceTranscriptionResponseSchema } from "@patcher/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface SystemAttentionArgs {
  signal?: AbortSignal;
}

export interface SystemConfigArgs {
  signal?: AbortSignal;
}

export interface SystemExecutionOptionsArgs extends SystemExecutionOptionsQuery {
  signal?: AbortSignal;
}

export interface SystemUsageLimitsArgs extends SystemUsageLimitsQuery {
  signal?: AbortSignal;
}

export interface SystemVersionArgs {
  force?: boolean;
  signal?: AbortSignal;
}

export interface SystemVoiceTranscriptionArgs {
  file: Blob;
  prompt?: string;
  signal?: AbortSignal;
}

export type SystemAttentionResult = SystemAttentionResponse;
export type SystemConfigResult = SystemConfigResponse;
export type SystemExecutionOptionsResult = SystemExecutionOptionsResponse;
export type SystemReloadConfigResult = SystemConfigReloadResponse;
export type SystemInstallCliSkillsArgs = SystemInstallCliSkillsRequest;
export interface SystemCliSkillsStatusArgs {
  /** Omit for every enrolled machine. */
  hostIds?: readonly string[];
  signal?: AbortSignal;
}
export type SystemCliSkillsStatusResult = SystemCliSkillsStatusResponse;
export type SystemInstallCliSkillsResult = SystemInstallCliSkillsResponse;
export interface SystemCliCommandStatusArgs {
  /** Omit for the primary machine. */
  hostIds?: readonly string[];
  signal?: AbortSignal;
}
export type SystemCliCommandStatusResult = SystemCliCommandStatusResponse;
export type SystemInstallCliCommandArgs = SystemInstallCliCommandRequest;
export type SystemInstallCliCommandResult = SystemInstallCliCommandResponse;
export type SystemCliSkillsSetupArgs = SystemCliSkillsSetupRequest;
export type SystemCliSkillsSetupResult = SystemCliSkillsSetupResponse;

export type SystemCliSkillsOfferArgs = SystemCliSkillsOfferRequest;

export type SystemCliSkillsOfferResult = SystemCliSkillsOfferResponse;
export type SystemVoiceTranscriptionResult = SystemVoiceTranscriptionResponse;
export type SystemUpdateExperimentsResult = Experiments;
export type SystemUpdateGeneralSettingsResult = AppSettings;
export type SystemBrowserAccessGrantsResult =
  SystemBrowserAccessGrantListResponse;
export type SystemCreateBrowserAccessGrantArgs =
  SystemBrowserAccessGrantCreateRequest;
export type SystemCreateBrowserAccessGrantResult =
  SystemBrowserAccessGrantCreateResponse;
export type SystemBrowserAccessRequestsResult =
  SystemBrowserAccessRequestListResponse;
export type SystemRequestBrowserAccessArgs =
  SystemBrowserAccessRequestCreateRequest;
export type SystemRequestBrowserAccessResult =
  SystemBrowserAccessRequestCreateResponse;
export type SystemBrowserAccessRequestOutcomeResult =
  SystemBrowserAccessRequestOutcomeResponse;
export type SystemDecideBrowserAccessRequestArgs =
  SystemBrowserAccessRequestDecideRequest;
export type SystemBrowserExternalAccessArgs =
  SystemBrowserExternalAccessRequest;
export type SystemBrowserExternalAccessResult =
  SystemBrowserExternalAccessResponse;
export type SystemUpdateKeyboardSettingsResult = AppKeybindingOverrides;
export type SystemUsageLimitsResult = ProviderUsageResponse;
export interface SystemOnboardingArgs extends SystemProvidersQuery {
  signal?: AbortSignal;
}
export interface SystemOnboardingReposArgs extends SystemOnboardingReposQuery {
  signal?: AbortSignal;
}
export type SystemOnboardingAgentsResult = OnboardingAgentOverview;
export type SystemOnboardingReposResult = DiscoverReposResult;
export type SystemVersionResult = SystemVersionResponse;

export interface SystemArea {
  attention(args?: SystemAttentionArgs): Promise<SystemAttentionResult>;
  config(args?: SystemConfigArgs): Promise<SystemConfigResult>;
  executionOptions(
    args?: SystemExecutionOptionsArgs,
  ): Promise<SystemExecutionOptionsResult>;
  /**
   * Copy Patcher's built-in CLI skills into each named machine's global agent skill
   * roots (`~/.agents/skills` and `~/.claude/skills`). Machines install
   * independently; the result reports each machine's outcome.
   */
  /** Per-machine install state of Patcher's built-in CLI skills. */
  cliSkillsStatus(
    args?: SystemCliSkillsStatusArgs,
  ): Promise<SystemCliSkillsStatusResult>;
  installCliSkills(
    args: SystemInstallCliSkillsArgs,
  ): Promise<SystemInstallCliSkillsResult>;
  /** Where a bare `patcher` stands on each machine asked, or the primary one. */
  cliCommandStatus(
    args?: SystemCliCommandStatusArgs,
  ): Promise<SystemCliCommandStatusResult>;
  /**
   * Put a `patcher` on the person's PATH, by linking this install's shim into a
   * directory their login shell already reads. Refused inside a turn, like
   * `installCliSkills`.
   */
  installCliCommand(
    args?: SystemInstallCliCommandArgs,
  ): Promise<SystemInstallCliCommandResult>;
  /**
   * Record the answer to the launch-time question about installing the CLI
   * skills for agents outside Patcher; `accept` also installs them onto the
   * primary machine. Refused inside a turn, like `installCliSkills`.
   */
  setupCliSkills(
    args: SystemCliSkillsSetupArgs,
  ): Promise<SystemCliSkillsSetupResult>;
  /**
   * Answer for a skill that shipped after the CLI skills were first installed
   * (#142); `accept` installs it on the machines that are missing it. Refused
   * inside a turn, like `installCliSkills`.
   */
  answerCliSkillsOffer(
    args: SystemCliSkillsOfferArgs,
  ): Promise<SystemCliSkillsOfferResult>;
  reloadConfig(): Promise<SystemReloadConfigResult>;
  transcribeVoice(
    args: SystemVoiceTranscriptionArgs,
  ): Promise<SystemVoiceTranscriptionResult>;
  updateExperiments(args: Experiments): Promise<SystemUpdateExperimentsResult>;
  updateGeneralSettings(
    args: AppSettings,
  ): Promise<SystemUpdateGeneralSettingsResult>;
  /**
   * Set how far agents outside Patcher may drive the browser, enabling the
   * plugin that serves them if it is off.
   *
   * Its own call rather than a field on `updateGeneralSettings`, because the
   * route is its own: called from inside a turn it raises a prompt on that
   * thread and changes nothing unless the user allows it.
   */
  setBrowserExternalAccess(
    args: SystemBrowserExternalAccessArgs,
  ): Promise<SystemBrowserExternalAccessResult>;
  /** Every browser access grant, live and revoked. Never their credentials. */
  browserAccessGrants(): Promise<SystemBrowserAccessGrantsResult>;
  /**
   * Mint a credential that opens the browser for one agent outside Patcher, and
   * nothing else.
   *
   * The one call that answers with a credential, which is why it is refused
   * inside a turn: a grant outlives the turn a thread key dies with. See
   * `agent-route-policy.ts` in the server.
   */
  createBrowserAccessGrant(
    args: SystemCreateBrowserAccessGrantArgs,
  ): Promise<SystemCreateBrowserAccessGrantResult>;
  /**
   * Stop a grant for now, or let it work again.
   *
   * The other half of "stop", beside revoking: a paused grant refuses every
   * request and stays a valid credential, so the agent holding it needs no
   * reconfiguring when the person changes their mind. Revoked grants cannot be
   * paused or resumed — that decision has no undo.
   */
  setBrowserAccessGrantPaused(
    grantId: string,
    paused: boolean,
  ): Promise<SystemBrowserAccessGrantsResult>;
  /** Take a grant back. The next request presenting it is refused. */
  revokeBrowserAccessGrant(
    grantId: string,
  ): Promise<SystemBrowserAccessGrantsResult>;
  /** Requests for a grant still waiting on the person, oldest first. */
  browserAccessRequests(): Promise<SystemBrowserAccessRequestsResult>;
  /**
   * Ask the person, in Patcher's window, for a grant (#135).
   *
   * Asking again under a label that already has an open request, at the same
   * level, answers with that request rather than raising a second one — so a
   * caller whose wait was cut short picks up where it left off.
   */
  requestBrowserAccess(
    args: SystemRequestBrowserAccessArgs,
  ): Promise<SystemRequestBrowserAccessResult>;
  /** Where a request stands. An approval's key is handed over once. */
  browserAccessRequestOutcome(
    requestId: string,
  ): Promise<SystemBrowserAccessRequestOutcomeResult>;
  /** Answer a request. Allowing mints the grant, at the level chosen. */
  decideBrowserAccessRequest(
    requestId: string,
    args: SystemDecideBrowserAccessRequestArgs,
  ): Promise<SystemBrowserAccessRequestsResult>;
  updateKeyboardSettings(
    args: AppKeybindingOverrides,
  ): Promise<SystemUpdateKeyboardSettingsResult>;
  /** Report one onboarding funnel event to anonymous telemetry. */
  onboardingEvent(args: OnboardingTelemetryEvent): Promise<{ ok: true }>;
  /** Live agent state for onboarding: install, auth, and plan per provider. */
  onboardingAgents(
    args?: SystemOnboardingArgs,
  ): Promise<SystemOnboardingAgentsResult>;
  /** Candidate projects discovered on the host, ranked for onboarding. */
  onboardingRepos(
    args?: SystemOnboardingReposArgs,
  ): Promise<SystemOnboardingReposResult>;
  usageLimits(args?: SystemUsageLimitsArgs): Promise<SystemUsageLimitsResult>;
  version(args?: SystemVersionArgs): Promise<SystemVersionResult>;
}

function versionQuery(args: SystemVersionArgs | undefined): SystemVersionQuery {
  return args?.force === undefined
    ? {}
    : { force: args.force ? "true" : "false" };
}

export function createSystemArea(args: CreateSdkAreaArgs): SystemArea {
  const { transport } = args;
  return {
    async attention(input) {
      return transport.readJson(
        transport.api.v1.system.attention.$get(
          {},
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async config(input) {
      return transport.readJson(
        transport.api.v1.system.config.$get(
          {},
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async executionOptions(input = {}) {
      return transport.readJson(
        transport.api.v1.system["execution-options"].$get(
          {
            query: {
              environmentId: input.environmentId,
              hostId: input.hostId,
              providerId: input.providerId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async cliSkillsStatus(input = {}) {
      return transport.readJson(
        transport.api.v1.system["cli-skills"].$get(
          {
            query:
              input.hostIds === undefined
                ? {}
                : { hostIds: input.hostIds.join(",") },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async installCliSkills(input) {
      return transport.readJson(
        transport.api.v1.system["cli-skills"].install.$post({ json: input }),
      );
    },
    async cliCommandStatus(input = {}) {
      return transport.readJson(
        transport.api.v1.system["cli-command"].$get(
          {
            query:
              input.hostIds === undefined
                ? {}
                : { hostIds: input.hostIds.join(",") },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async installCliCommand(input = {}) {
      return transport.readJson(
        transport.api.v1.system["cli-command"].install.$post({ json: input }),
      );
    },
    async setupCliSkills(input) {
      return transport.readJson(
        transport.api.v1.system["cli-skills"].setup.$post({ json: input }),
      );
    },
    async answerCliSkillsOffer(input) {
      return transport.readJson(
        transport.api.v1.system["cli-skills"].offer.$post({ json: input }),
      );
    },
    async reloadConfig() {
      return transport.readJson(transport.api.v1.system.config.reload.$post());
    },
    async transcribeVoice(input) {
      if (input.file.size === 0) {
        throw new Error("Audio file must not be empty");
      }
      const form = new FormData();
      form.set("file", input.file);
      if (input.prompt !== undefined) form.set("prompt", input.prompt);
      const baseUrl = transport.baseUrl.replace(/\/$/u, "");
      const response = await transport.resolve(
        transport.fetch(`${baseUrl}/api/v1/system/voice-transcription`, {
          method: "POST",
          body: form,
          signal: input.signal,
        }),
      );
      return systemVoiceTranscriptionResponseSchema.parse(
        await response.json(),
      );
    },
    async updateExperiments(input) {
      return transport.readJson(
        transport.api.v1.settings.experiments.$put({ json: input }),
      );
    },
    async updateGeneralSettings(input) {
      return transport.readJson(
        transport.api.v1.settings.general.$put({ json: input }),
      );
    },
    async setBrowserExternalAccess(input) {
      return transport.readJson(
        transport.api.v1.browser["external-access"].$post({ json: input }),
      );
    },
    async browserAccessGrants() {
      return transport.readJson(
        transport.api.v1.browser["access-grants"].$get(),
      );
    },
    async createBrowserAccessGrant(input) {
      return transport.readJson(
        transport.api.v1.browser["access-grants"].$post({ json: input }),
      );
    },
    async setBrowserAccessGrantPaused(grantId, paused) {
      return transport.readJson(
        transport.api.v1.browser["access-grants"][":id"].$put({
          param: { id: grantId },
          json: { paused },
        }),
      );
    },
    async revokeBrowserAccessGrant(grantId) {
      return transport.readJson(
        transport.api.v1.browser["access-grants"][":id"].$delete({
          param: { id: grantId },
        }),
      );
    },
    async browserAccessRequests() {
      return transport.readJson(
        transport.api.v1.browser["access-requests"].$get(),
      );
    },
    async requestBrowserAccess(input) {
      return transport.readJson(
        transport.api.v1.browser["access-requests"].$post({ json: input }),
      );
    },
    async browserAccessRequestOutcome(requestId) {
      return transport.readJson(
        transport.api.v1.browser["access-requests"][":id"].outcome.$post({
          param: { id: requestId },
        }),
      );
    },
    async decideBrowserAccessRequest(requestId, input) {
      return transport.readJson(
        transport.api.v1.browser["access-requests"][":id"].decide.$post({
          param: { id: requestId },
          json: input,
        }),
      );
    },
    async updateKeyboardSettings(input) {
      return transport.readJson(
        transport.api.v1.settings.keyboard.$put({ json: input }),
      );
    },
    async onboardingEvent(input) {
      return transport.readJson(
        transport.api.v1.system.onboarding.event.$post({ json: input }),
      );
    },
    async onboardingAgents(input = {}) {
      return transport.readJson(
        transport.api.v1.system.onboarding.agents.$get(
          {
            query: {
              environmentId: input.environmentId,
              hostId: input.hostId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async onboardingRepos(input = {}) {
      return transport.readJson(
        transport.api.v1.system.onboarding.repos.$get(
          { query: { hostId: input.hostId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async usageLimits(input = {}) {
      return transport.readJson(
        transport.api.v1.system["usage-limits"].$get(
          { query: { hostId: input.hostId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async version(input) {
      return transport.readJson(
        transport.api.v1.system.version.$get(
          { query: versionQuery(input) },
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
  };
}
