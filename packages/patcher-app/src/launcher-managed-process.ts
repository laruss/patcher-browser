import { spawn, type ChildProcess } from "node:child_process";
import type { Duplex } from "node:stream";
import type { DesktopSecretRelay } from "./desktop-secret-relay.js";

export interface ManagedSpawnArgs {
  args: string[];
  command: string;
  env: NodeJS.ProcessEnv;
  outputBuffer: { handler(chunk: Buffer | string): void };
  secretRelay?: DesktopSecretRelay;
}

export function spawnManagedProcess(args: ManagedSpawnArgs): ChildProcess {
  const child = spawn(args.command, args.args, {
    cwd: process.cwd(),
    env: args.env,
    stdio:
      args.secretRelay === undefined
        ? ["ignore", "pipe", "inherit"]
        : ["ignore", "pipe", "inherit", "pipe"],
  });
  if (child.stdout === null)
    throw new Error("Expected managed process stdout to be piped");
  child.stdout.on("data", args.outputBuffer.handler);
  if (args.secretRelay !== undefined)
    args.secretRelay.attach(child.stdio[3] as Duplex);
  return child;
}
