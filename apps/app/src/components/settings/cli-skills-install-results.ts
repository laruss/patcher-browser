import type { SystemInstallCliSkillsResponse } from "@patcher/server-contract";
import { appToast } from "@/components/ui/app-toast";

/**
 * Report the per-machine outcome of a CLI skills install. The route installs
 * machines independently, so a partial success is a real outcome and both
 * halves get surfaced.
 *
 * Its own module because two places install — the Settings section and the
 * launch-time question — and the question should not import the Settings
 * section to say how it went.
 */
export function reportInstallResults(
  result: SystemInstallCliSkillsResponse,
): void {
  const installed = result.results.filter((entry) => entry.ok);
  const failed = result.results.filter((entry) => !entry.ok);
  if (installed.length > 0) {
    appToast.success(
      `Installed the Patcher CLI skills on ${installed
        .map((entry) => entry.hostName)
        .join(", ")}`,
    );
  }
  for (const entry of failed) {
    appToast.error(`${entry.hostName}: ${entry.errorMessage}`);
  }
}
