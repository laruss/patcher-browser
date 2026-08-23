import {
  derivePluginId,
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
} from "@patcher/domain";

export function createPluginArtifactMeta(args: {
  packageName: string;
  pluginVersion: string;
  patcherVersion: string;
}) {
  return {
    sdkMajor: PLUGIN_SDK_MAJOR,
    sdkVersion: PLUGIN_SDK_VERSION,
    artifactFormatVersion: 1,
    pluginId: derivePluginId(args.packageName),
    pluginVersion: args.pluginVersion,
    builtWith: {
      patcherVersion: args.patcherVersion,
      pluginSdkVersion: PLUGIN_SDK_VERSION,
    },
  } as const;
}
