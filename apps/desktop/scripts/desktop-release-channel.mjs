export const DESKTOP_RELEASE_CHANNEL_ENV_NAME =
  "PATCHER_DESKTOP_RELEASE_CHANNEL";

export function resolveDesktopReleaseChannel(env) {
  const rawChannel = env[DESKTOP_RELEASE_CHANNEL_ENV_NAME]?.trim();
  if (rawChannel === undefined || rawChannel.length === 0) {
    return "latest";
  }
  if (rawChannel === "latest" || rawChannel === "nightly") {
    return rawChannel;
  }

  throw new Error(
    `${DESKTOP_RELEASE_CHANNEL_ENV_NAME} must be latest or nightly, got ${rawChannel}.`,
  );
}

export function createDesktopReleaseConfig(channel) {
  if (channel === "nightly") {
    return {
      appId: "app.patcher.desktop.nightly",
      applicationName: "Patcher Nightly",
      artifactName: "patcher-nightly-${version}-${arch}.${ext}",
      iconFileName: "icon-nightly.png",
      macIconPath: "assets/icon-nightly.icns",
      releaseTag: "desktop-nightly",
      updateMetadataFileName: "nightly-mac.yml",
    };
  }

  return {
    appId: "app.patcher.desktop",
    applicationName: "Patcher",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    iconFileName: "icon.png",
    macIconPath: "assets/icon.icns",
    releaseTag: "desktop-latest",
    updateMetadataFileName: "latest-mac.yml",
  };
}

export function createDesktopUpdateReleaseBaseUrl(releaseTag) {
  return `https://github.com/laruss/patcher-browser/releases/download/${releaseTag}/`;
}
