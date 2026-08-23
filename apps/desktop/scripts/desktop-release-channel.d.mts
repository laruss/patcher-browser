export type DesktopReleaseChannel = "latest" | "nightly";

export interface DesktopReleaseConfig {
  appId: "app.patcher.desktop" | "app.patcher.desktop.nightly";
  applicationName: "Patcher" | "Patcher Nightly";
  artifactName: string;
  iconFileName: "icon.png" | "icon-nightly.png";
  macIconPath: "assets/icon.icns" | "assets/icon-nightly.icns";
  releaseTag: "desktop-latest" | "desktop-nightly";
  updateMetadataFileName: "latest-mac.yml" | "nightly-mac.yml";
}

export const DESKTOP_RELEASE_CHANNEL_ENV_NAME: "PATCHER_DESKTOP_RELEASE_CHANNEL";

export function resolveDesktopReleaseChannel(
  env: NodeJS.ProcessEnv,
): DesktopReleaseChannel;

export function createDesktopReleaseConfig(
  channel: DesktopReleaseChannel,
): DesktopReleaseConfig;

export function createDesktopUpdateReleaseBaseUrl(
  releaseTag: DesktopReleaseConfig["releaseTag"],
): string;
