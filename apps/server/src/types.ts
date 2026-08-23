import type {
  CustomAcpAgent,
  CustomProviderModel,
} from "@patcher/config/patcher-app-managed-config";
import type { AppSurface } from "@patcher/config/app-surface";
import type { DbConnection } from "@patcher/db";
import type { FeatureFlags, ProviderNativeSkillRoots } from "@patcher/domain";
import type { Logger } from "@patcher/logger";
import type { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import type { MachineAuthService } from "./services/machine-auth.js";
import type { AppVersionService } from "./services/system/app-version.js";
import type { PatcherAppManagedConfigReloader } from "./services/system/patcher-app-managed-config.js";
import type { TelemetryService } from "./services/system/telemetry.js";
import type { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import type { LifecycleDedupers } from "./lifecycle-dedupers.js";
import type { NotificationHub } from "./ws/hub.js";
import type { WatchInterestCoordinator } from "./ws/watch-interests.js";
import type { SkillTreeRegistry } from "./services/skills/injected-skills.js";

export type ServerLogger = Pick<Logger, "debug" | "error" | "info" | "warn">;

export interface ServerRuntimeConfig {
  appVersion: string;
  appSurface: AppSurface;
  builtinSkillsRootPath: string;
  customAcpAgents: CustomAcpAgent[];
  customModels: CustomProviderModel[];
  dataDir: string;
  featureFlags: FeatureFlags;
  hostDaemonPort: number;
  inheritedSkillsRootPaths: string[];
  inferenceFallbackModel: string;
  inferenceModel: string;
  isDevelopment: boolean;
  /**
   * Grace window (ms) after the last live thread in a managed environment is
   * archived before its worktree is destroyed, during which an accidental
   * archive can be undone losslessly. Defaults to
   * {@link MANAGED_ENVIRONMENT_RETIRE_GRACE_MS}; set to 0 to destroy immediately.
   */
  managedEnvironmentRetireGraceMs: number;
  openAiApiKey: string;
  serverPort: number;
  sharedSkillRoots: ProviderNativeSkillRoots;
  threadStorageRootPath: string;
  transcriptionModel: string;
  appUrl?: string;
  devAppPort?: number;
}

export interface AppDeps {
  config: ServerRuntimeConfig;
  db: DbConnection;
  hub: NotificationHub;
  lifecycleDedupers: LifecycleDedupers;
  logger: ServerLogger;
  machineAuth: MachineAuthService;
  pendingInteractions: PendingInteractionLifecycle;
  skillTreeRegistry: SkillTreeRegistry;
  telemetry: TelemetryService;
  terminalSessions: TerminalSessionLifecycle;
  watchInterests: WatchInterestCoordinator;
}

export interface ServerAppDeps extends AppDeps {
  appVersion: AppVersionService;
  patcherAppManagedConfig: PatcherAppManagedConfigReloader;
}

export type LifecycleDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "machineAuth"
  | "skillTreeRegistry"
  | "telemetry"
>;

export type WorkSessionDeps = LifecycleDeps;

export type LoggedWorkSessionDeps = WorkSessionDeps & Pick<AppDeps, "logger">;

export type PendingInteractionWorkSessionDeps = WorkSessionDeps &
  Pick<AppDeps, "pendingInteractions">;

export type LoggedPendingInteractionWorkSessionDeps =
  PendingInteractionWorkSessionDeps &
    Pick<AppDeps, "logger" | "terminalSessions">;
