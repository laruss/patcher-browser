import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const SERVER_TARGET_FILE_NAME = "server-target.json";
export const BUILTIN_SERVER_NAME = "This Mac";

export type DesktopServerTarget =
  | { kind: "builtin" }
  | { kind: "custom"; url: string };

export interface ServerTargetFs {
  mkdir(
    path: string,
    options: { recursive: true },
  ): Promise<string | undefined>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

export interface CreateServerTargetStoreArgs {
  fs?: ServerTargetFs;
  storagePath: string;
}

export interface ServerTargetStore {
  /** The custom server URL, whether or not it is the active target. */
  getCustomServerUrl(): string | null;
  getTarget(): DesktopServerTarget;
  load(): Promise<void>;
  /**
   * Set the custom server URL and make it the active target. Passing null
   * clears the custom entry and re-targets the builtin server.
   */
  setCustomServerUrl(url: string | null): Promise<void>;
  /**
   * Switch the active target. Returns false (no-op) when asked to target
   * "custom" while no such server is set.
   */
  setTarget(kind: "builtin" | "custom"): Promise<boolean>;
}

const persistedServerTargetSchema = z
  .object({
    customServerUrl: z.string().min(1).nullable(),
    target: z.enum(["builtin", "custom"]),
  })
  .strict();

type PersistedServerTarget = z.infer<typeof persistedServerTargetSchema>;

const defaultFs: ServerTargetFs = {
  mkdir,
  readFile,
  writeFile,
};

/** Trimmed http(s) URL without hash or trailing slash, or null when invalid. */
export function normalizeCustomServerUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function parsePersistedServerTarget(raw: string): PersistedServerTarget | null {
  try {
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = persistedServerTargetSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createServerTargetStore(
  args: CreateServerTargetStoreArgs,
): ServerTargetStore {
  const fsImpl = args.fs ?? defaultFs;
  let customServerUrl: string | null = null;
  let target: "builtin" | "custom" = "builtin";

  async function persist(): Promise<void> {
    await fsImpl.mkdir(dirname(args.storagePath), { recursive: true });
    const payload: PersistedServerTarget = {
      customServerUrl,
      target,
    };
    await fsImpl.writeFile(
      args.storagePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    getCustomServerUrl() {
      return customServerUrl;
    },
    getTarget() {
      if (target === "custom" && customServerUrl !== null) {
        return { kind: "custom", url: customServerUrl };
      }
      return { kind: "builtin" };
    },
    async load() {
      let persisted: PersistedServerTarget | null = null;
      try {
        persisted = parsePersistedServerTarget(
          await fsImpl.readFile(args.storagePath, "utf8"),
        );
      } catch {
        persisted = null;
      }
      if (persisted === null) {
        customServerUrl = null;
        target = "builtin";
        return;
      }
      customServerUrl =
        persisted.customServerUrl === null
          ? null
          : normalizeCustomServerUrl(persisted.customServerUrl);
      // A custom target without a valid server falls back to builtin at the
      // load boundary so getTarget() never returns a dangling target.
      target =
        persisted.target === "custom" && customServerUrl !== null
          ? "custom"
          : "builtin";
    },
    async setCustomServerUrl(url) {
      if (url === null) {
        customServerUrl = null;
        if (target === "custom") {
          target = "builtin";
        }
      } else {
        customServerUrl = url;
        target = "custom";
      }
      await persist();
    },
    async setTarget(kind) {
      if (kind === "custom" && customServerUrl === null) {
        return false;
      }
      if (target === kind) {
        return true;
      }
      target = kind;
      await persist();
      return true;
    },
  };
}
