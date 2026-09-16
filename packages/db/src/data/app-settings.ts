import { eq } from "drizzle-orm";
import {
  appKeybindingOverridesSchema,
  browserExternalAccessLevelSchema,
  defaultAppSettings,
  cliSkillsAnsweredSchema,
  type CliSkillsAnswered,
  outsideAgentSetupAnswerSchema,
  providerEgressAllowedHostsSchema,
  type AppKeybindingOverrides,
  type AppSettings,
  type BrowserExternalAccessLevel,
  type OutsideAgentSetupAnswer,
} from "@patcher/domain";
import type { DbConnection } from "../connection.js";
import { appSettings } from "../schema.js";

const APP_SETTINGS_ROW_ID = "current";

export function getAppSettings(db: DbConnection): AppSettings {
  const row = db
    .select({
      caffeinate: appSettings.caffeinate,
      showKeyboardHints: appSettings.showKeyboardHints,
      steerActiveThreadOnEnter: appSettings.steerActiveThreadOnEnter,
      showUnhandledProviderEvents: appSettings.showUnhandledProviderEvents,
      codexMemoryEnabled: appSettings.codexMemoryEnabled,
      claudeCodeMemoryEnabled: appSettings.claudeCodeMemoryEnabled,
      codexSubagentsDisabled: appSettings.codexSubagentsDisabled,
      claudeCodeSubagentsDisabled: appSettings.claudeCodeSubagentsDisabled,
      claudeCodeWorkflowsDisabled: appSettings.claudeCodeWorkflowsDisabled,
      codexNetworkDisabled: appSettings.codexNetworkDisabled,
      providerEgressConfined: appSettings.providerEgressConfined,
      providerEgressAllowedHosts: appSettings.providerEgressAllowedHosts,
      onboardingCompletedAt: appSettings.onboardingCompletedAt,
      browserSearchEngineId: appSettings.browserSearchEngineId,
      browserExternalAccess: appSettings.browserExternalAccess,
    })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .get();

  if (row === undefined) {
    return defaultAppSettings;
  }
  return {
    ...row,
    providerEgressAllowedHosts: parseEgressAllowedHosts(
      row.providerEgressAllowedHosts,
    ),
    browserExternalAccess: parseBrowserExternalAccess(row.browserExternalAccess),
  };
}

/**
 * The stored level, or the closed one.
 *
 * Same reasoning as the host list below — the column is text, so a row written
 * by a future version or by hand must not take the settings endpoint down. The
 * fallback is deliberately `off` rather than `defaultAppSettings`\'s value read
 * back: they are the same today, and if the default ever moves, a value nobody
 * can parse should still resolve to the browser being closed.
 */
function parseBrowserExternalAccess(
  stored: string,
): BrowserExternalAccessLevel {
  const parsed = browserExternalAccessLevelSchema.safeParse(stored);
  return parsed.success ? parsed.data : "off";
}

/**
 * The stored host list, or an empty one.
 *
 * A row written by a future version, or by hand, must not take the settings
 * endpoint down with it — every other field here survives a bad value by being
 * typed at the column, and this one is text holding JSON.
 */
function parseEgressAllowedHosts(stored: string): string[] {
  try {
    return providerEgressAllowedHostsSchema.parse(JSON.parse(stored));
  } catch {
    return [];
  }
}

export function setAppSettings(
  db: DbConnection,
  settings: AppSettings,
): void {
  const updatedAt = Date.now();
  db.insert(appSettings)
    .values({
      id: APP_SETTINGS_ROW_ID,
      caffeinate: settings.caffeinate,
      showKeyboardHints: settings.showKeyboardHints,
      steerActiveThreadOnEnter: settings.steerActiveThreadOnEnter,
      showUnhandledProviderEvents: settings.showUnhandledProviderEvents,
      codexMemoryEnabled: settings.codexMemoryEnabled,
      claudeCodeMemoryEnabled: settings.claudeCodeMemoryEnabled,
      codexSubagentsDisabled: settings.codexSubagentsDisabled,
      claudeCodeSubagentsDisabled: settings.claudeCodeSubagentsDisabled,
      claudeCodeWorkflowsDisabled: settings.claudeCodeWorkflowsDisabled,
      codexNetworkDisabled: settings.codexNetworkDisabled,
      providerEgressConfined: settings.providerEgressConfined,
      providerEgressAllowedHosts: JSON.stringify(
        settings.providerEgressAllowedHosts,
      ),
      onboardingCompletedAt: settings.onboardingCompletedAt,
      browserSearchEngineId: settings.browserSearchEngineId,
      browserExternalAccess: settings.browserExternalAccess,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        caffeinate: settings.caffeinate,
        showKeyboardHints: settings.showKeyboardHints,
        steerActiveThreadOnEnter: settings.steerActiveThreadOnEnter,
        showUnhandledProviderEvents: settings.showUnhandledProviderEvents,
        codexMemoryEnabled: settings.codexMemoryEnabled,
        claudeCodeMemoryEnabled: settings.claudeCodeMemoryEnabled,
        codexSubagentsDisabled: settings.codexSubagentsDisabled,
        claudeCodeSubagentsDisabled: settings.claudeCodeSubagentsDisabled,
        claudeCodeWorkflowsDisabled: settings.claudeCodeWorkflowsDisabled,
        codexNetworkDisabled: settings.codexNetworkDisabled,
        providerEgressConfined: settings.providerEgressConfined,
        providerEgressAllowedHosts: JSON.stringify(
          settings.providerEgressAllowedHosts,
        ),
        onboardingCompletedAt: settings.onboardingCompletedAt,
        browserSearchEngineId: settings.browserSearchEngineId,
        browserExternalAccess: settings.browserExternalAccess,
        updatedAt,
      },
    })
    .run();
}

/**
 * The person's answer to installing Patcher's skills for agents outside Patcher
 * (#141). No row, or text nobody can parse, is `unasked`.
 *
 * Its own getter and setter rather than a field of {@link AppSettings}, because
 * `setAppSettings` is fed whole objects by every window — see
 * `outsideAgentSetupAnswerSchema` for why that would undo the answer.
 */
export function getOutsideAgentSetup(db: DbConnection): OutsideAgentSetupAnswer {
  const row = db
    .select({ outsideAgentSetup: appSettings.outsideAgentSetup })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .get();
  const parsed = outsideAgentSetupAnswerSchema.safeParse(
    row?.outsideAgentSetup,
  );
  return parsed.success ? parsed.data : "unasked";
}

export function setOutsideAgentSetup(
  db: DbConnection,
  answer: OutsideAgentSetupAnswer,
): void {
  const updatedAt = Date.now();
  db.insert(appSettings)
    .values({ id: APP_SETTINGS_ROW_ID, outsideAgentSetup: answer, updatedAt })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { outsideAgentSetup: answer, updatedAt },
    })
    .run();
}

/**
 * The answers to skills for agents outside Patcher that shipped after the first
 * yes (#142), by skill name. No row, or text nobody can parse, reads as no
 * answers: the question comes back, which is the safe direction — the other one
 * silently never offers a skill again.
 */
export function getAnsweredCliSkills(db: DbConnection): CliSkillsAnswered {
  const row = db
    .select({ cliSkillsAnswered: appSettings.cliSkillsAnswered })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .get();
  if (row === undefined) return {};
  let stored: unknown;
  try {
    stored = JSON.parse(row.cliSkillsAnswered);
  } catch {
    return {};
  }
  const parsed = cliSkillsAnsweredSchema.safeParse(stored);
  return parsed.success ? parsed.data : {};
}

export function setAnsweredCliSkills(
  db: DbConnection,
  answered: CliSkillsAnswered,
): void {
  const updatedAt = Date.now();
  const cliSkillsAnswered = JSON.stringify(answered);
  db.insert(appSettings)
    .values({ id: APP_SETTINGS_ROW_ID, cliSkillsAnswered, updatedAt })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { cliSkillsAnswered, updatedAt },
    })
    .run();
}

export function getAppKeybindingOverrides(
  db: DbConnection,
): AppKeybindingOverrides {
  const row = db
    .select({ keybindingOverrides: appSettings.keybindingOverrides })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .get();

  if (row === undefined) {
    return [];
  }
  return appKeybindingOverridesSchema.parse(
    JSON.parse(row.keybindingOverrides),
  );
}

export function setAppKeybindingOverrides(
  db: DbConnection,
  overrides: AppKeybindingOverrides,
): void {
  const updatedAt = Date.now();
  db.insert(appSettings)
    .values({
      id: APP_SETTINGS_ROW_ID,
      keybindingOverrides: JSON.stringify(overrides),
      updatedAt,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        keybindingOverrides: JSON.stringify(overrides),
        updatedAt,
      },
    })
    .run();
}
