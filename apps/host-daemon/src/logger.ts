import type { Logger } from "@patcher/logger";

export type HostDaemonLogger = Pick<
  Logger,
  "debug" | "info" | "warn" | "error"
>;
