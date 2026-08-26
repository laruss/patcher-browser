import { withAppKeyQuery } from "@/lib/app-key";
import { buildDevWebSocketUrl } from "@/lib/dev-websocket-url";

interface BuildTerminalWebSocketUrlArgs {
  terminalId: string;
}

function buildTerminalWebSocketPath({
  terminalId,
}: BuildTerminalWebSocketUrlArgs): string {
  return `/ws/terminals/${encodeURIComponent(terminalId)}`;
}

function buildWebSocketUrl(path: string): string {
  const devWebSocketUrl = buildDevWebSocketUrl({ path });
  if (devWebSocketUrl !== undefined) {
    return devWebSocketUrl;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function buildTerminalWebSocketUrl(
  args: BuildTerminalWebSocketUrlArgs,
): string {
  // The key rides in the query for the same reason it does on `/ws`: a browser
  // `WebSocket` sets no request headers, and `/ws/terminals/:id` reaches the
  // same streams `/api/v1/terminals` does and is gated the same way.
  return withAppKeyQuery(buildWebSocketUrl(buildTerminalWebSocketPath(args)));
}
