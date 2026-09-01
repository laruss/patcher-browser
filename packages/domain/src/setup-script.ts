import { z } from "zod";

export const DEFAULT_ENV_SETUP_SCRIPT_NAME = ".patcher-env-setup.sh";

/**
 * Gitignore-style pattern file. It names untracked files that a new worktree
 * must receive from the source checkout, such as `.env`.
 */
export const WORKTREE_INCLUDE_FILE_NAME = ".worktreeinclude";

/**
 * What is remembered about one repository's setup script on one machine.
 *
 * `allowed` is a person's yes, kept so the next worktree from that repository
 * asks nobody. `asked` is a question that was raised and never answered — a
 * schedule or a delegated thread provisions in a thread nobody is watching, and
 * the prompt times out there every time. Keeping it turns "nobody was there"
 * into something answerable afterwards, instead of the same four minutes lost
 * on every run.
 *
 * A decline is neither: it is a decision, and the design is that it is not
 * remembered — the same script asks again next time.
 */
export const ENV_SETUP_SCRIPT_CONSENT_STATUSES = ["asked", "allowed"] as const;
export type EnvSetupScriptConsentStatus =
  (typeof ENV_SETUP_SCRIPT_CONSENT_STATUSES)[number];
export const envSetupScriptConsentStatusSchema = z.enum(
  ENV_SETUP_SCRIPT_CONSENT_STATUSES,
);
