import { customAlphabet } from "nanoid";

const PRETTY_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const PRETTY_ID_SUFFIX_LENGTH = 10;

const generatePrettyIdSuffix = customAlphabet(
  PRETTY_ID_ALPHABET,
  PRETTY_ID_SUFFIX_LENGTH,
);

function createId(prefix: string): string {
  return `${prefix}_${generatePrettyIdSuffix()}`;
}

export function createHostId(): string {
  return createId("host");
}

export function createProjectId(): string {
  return createId("proj");
}

export function createProjectSourceId(): string {
  return createId("src");
}

export function createEnvironmentId(): string {
  return createId("env");
}

export function createEnvironmentProvisioningId(): string {
  return createId("epv");
}

export function createThreadId(): string {
  return createId("thr");
}

export function createThreadSectionId(): string {
  return createId("sec");
}

export function createThreadProvisioningId(): string {
  return createId("tpv");
}

export function createEventId(): string {
  return createId("evt");
}

export function createBrowserHistoryEntryId(): string {
  return createId("bhist");
}

export function createPromptHistoryEntryId(): string {
  return createId("phist");
}

export function createQueuedThreadMessageId(): string {
  return createId("qmsg");
}

export function createQueuedThreadMessageClaimToken(): string {
  return createId("qclaim");
}

export function createPendingInteractionId(): string {
  return createId("pint");
}

export function createHostDaemonSessionId(): string {
  return createId("hses");
}

export function createTerminalSessionId(): string {
  return createId("term");
}

export function createEnvSetupScriptConsentId(): string {
  return createId("escon");
}

/**
 * A browser access grant's id, which is also the public half of its credential.
 *
 * `PRETTY_ID_ALPHABET` has no `.` in it and `deriveAgentAccessKey` parses on
 * one, which is what lets the id ride in the credential unencoded. That
 * function refuses an id with a `.` rather than trusting this alphabet to stay
 * as it is.
 */
export function createBrowserAccessGrantId(): string {
  return createId("bag");
}
