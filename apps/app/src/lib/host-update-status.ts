import type { Host } from "@patcher/domain";
import {
  FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION,
  HOST_DAEMON_PROTOCOL_VERSION,
} from "@patcher/host-daemon-contract";

export function hostNeedsUpdate(host: Host): boolean {
  return (
    host.status === "disconnected" &&
    host.lastRejectedProtocolVersion !== null &&
    host.lastRejectedProtocolVersion !== HOST_DAEMON_PROTOCOL_VERSION
  );
}

/**
 * A daemon too old to fetch this server's artifact. It keeps retrying on its
 * own and every attempt 410s, so the only way forward is enrolling the machine
 * again — see FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION for why that is not
 * something the server can fix from its side.
 */
export function hostMustReEnroll(host: Host): boolean {
  return (
    hostNeedsUpdate(host) &&
    host.lastRejectedProtocolVersion !== null &&
    host.lastRejectedProtocolVersion < FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION
  );
}

export function hostCanRetryUpdate(host: Host): boolean {
  return (
    hostNeedsUpdate(host) &&
    !hostMustReEnroll(host) &&
    host.lastRejectedProtocolVersion !== null &&
    host.lastRejectedProtocolVersion < HOST_DAEMON_PROTOCOL_VERSION
  );
}

export function formatHostUpdateStatus(host: Host): string | null {
  if (!hostNeedsUpdate(host)) {
    return null;
  }
  if (hostMustReEnroll(host)) {
    return `Needs re-enrolling · daemon protocol ${host.lastRejectedProtocolVersion} is too old to update itself · server protocol ${HOST_DAEMON_PROTOCOL_VERSION}`;
  }
  return `Needs update · daemon protocol ${host.lastRejectedProtocolVersion} · server protocol ${HOST_DAEMON_PROTOCOL_VERSION}`;
}
