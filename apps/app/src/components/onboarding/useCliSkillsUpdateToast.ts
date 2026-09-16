import { useEffect, useRef } from "react";
import type { CliSkillsUpdateNotice } from "@patcher/server-contract";
import { appToast } from "@/components/ui/app-toast";

const SEEN_AT_STORAGE_KEY = "patcher.cliSkillsUpdateSeenAt";

function readStoredSeenAt(): number {
  try {
    const stored = Number(window.localStorage.getItem(SEEN_AT_STORAGE_KEY));
    return Number.isFinite(stored) ? stored : 0;
  } catch {
    return 0;
  }
}

function storeSeenAt(at: number): void {
  try {
    window.localStorage.setItem(SEEN_AT_STORAGE_KEY, String(at));
  } catch {
    // Without storage the window still remembers for as long as it is open.
  }
}

/** Long enough to read a path or two. */
const LEFT_BEHIND_DURATION_MS = 10_000;

function leftBehindDescription(paths: readonly string[]): string {
  const [wasOrWere, itOrThem] =
    paths.length === 1 ? ["it was", "it"] : ["they were", "them"];
  return `Left ${paths.join(", ")} as ${wasOrWere}; Install in Settings → Skills replaces ${itOrThem}.`;
}

/**
 * Say, once per window, that Patcher updated its skills for agents outside
 * Patcher on a machine (#142) — an agent in another terminal now follows
 * different instructions, and nobody pressed anything.
 *
 * The server holds the notices for its lifetime, since a window can connect
 * after the update happened; the window remembers the latest `at` it has shown,
 * in storage so a reload does not repeat it. Two windows open at once may each
 * say it.
 *
 * A copy the update left as it was is named under it (#148): the person who
 * changed one would otherwise hear that the skills were updated, and not that
 * theirs was not.
 *
 * `paused` holds it back while onboarding or the launch-time question is on
 * screen, so a toast never lands on top of either.
 */
export function useCliSkillsUpdateToast(args: {
  notices: readonly CliSkillsUpdateNotice[] | undefined;
  paused: boolean;
}): void {
  const { notices, paused } = args;
  const seenAt = useRef(0);

  useEffect(() => {
    if (paused || notices === undefined) return;
    const shownUpTo = Math.max(seenAt.current, readStoredSeenAt());
    const fresh = notices
      .filter((notice) => notice.at > shownUpTo)
      .sort((left, right) => left.at - right.at);
    const latest = fresh.at(-1);
    if (latest === undefined) return;
    for (const notice of fresh) {
      appToast.success(
        `Updated the Patcher skills for agents outside Patcher on ${notice.hostName}`,
        notice.skippedCopies.length === 0
          ? undefined
          : {
              description: leftBehindDescription(notice.skippedCopies),
              duration: LEFT_BEHIND_DURATION_MS,
            },
      );
    }
    seenAt.current = latest.at;
    storeSeenAt(latest.at);
  }, [notices, paused]);
}
