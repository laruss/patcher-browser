import {
  type EnvironmentDisplayInfo,
  formatEnvironmentDisplay,
} from "@patcher/core-ui";
import type { PatcherSdk } from "@patcher/sdk";

export interface ThreadEnvironmentInfo {
  display: EnvironmentDisplayInfo;
  hostId: string;
}

export async function fetchEnvironmentInfo(args: {
  environmentId: string;
  sdk: PatcherSdk;
}): Promise<ThreadEnvironmentInfo | null> {
  try {
    const env = await args.sdk.environments.get({
      environmentId: args.environmentId,
    });
    return {
      display: formatEnvironmentDisplay({
        environment: env,
        host: {
          locality: "local",
          identity: null,
        },
      }),
      hostId: env.hostId,
    };
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: ThreadEnvironmentInfo): void {
  console.log(`  Environment: ${env.display.modeLabel} (${env.display.id})`);
}
