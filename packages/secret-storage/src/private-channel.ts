import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { z } from "zod";
import {
  SECRET_STORAGE_CODES,
  SecretStorageError,
  secretStorageCode,
  type SecretStorageCode,
} from "./storage-error.js";

export const SECRET_CHANNEL_MAX_BYTES = 16_384;
const MAX_PENDING = 16;
const METHODS = ["status", "activate", "unlock", "wrap", "unwrap"] as const;
export type SecretChannelMethod = (typeof METHODS)[number];
export type SecretChannelNotice = "availability" | "server";
const id = z.uuid();
const version = z.literal(1);
const frameSchema = z.discriminatedUnion("kind", [
  z.object({ version, kind: z.literal("hello") }).strict(),
  z
    .object({
      version,
      kind: z.literal("request"),
      id,
      method: z.enum(METHODS),
      payload: z.unknown(),
    })
    .strict(),
  z
    .object({ version, kind: z.literal("result"), id, value: z.unknown() })
    .strict(),
  z
    .object({
      version,
      kind: z.literal("error"),
      id,
      code: z.enum(SECRET_STORAGE_CODES),
    })
    .strict(),
  z.object({ version, kind: z.literal("cancel"), id }).strict(),
  z
    .object({
      version,
      kind: z.literal("notice"),
      name: z.enum(["availability", "server"]),
      value: z.boolean(),
    })
    .strict(),
]);

interface Pending {
  finish(error: SecretStorageCode | null, value?: unknown): void;
}

/** Authenticated by its inherited pipe, never by an HTTP/renderer credential. */
export class PrivateSecretChannel {
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;
  private greeted = false;
  private pending = new Map<string, Pending>();
  private incoming = new Map<string, AbortController>();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly ready: Promise<void>;
  private readonly helloTimeout: ReturnType<typeof setTimeout>;

  constructor(
    private readonly stream: Duplex,
    private readonly handlers: {
      request?: (
        method: SecretChannelMethod,
        payload: unknown,
        signal: AbortSignal,
      ) => Promise<unknown>;
      notice?: (name: SecretChannelNotice, value: boolean) => void;
      close?: () => void;
    } = {},
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    void this.ready.catch(() => {});
    this.helloTimeout = setTimeout(() => this.close(), 5000);
    this.helloTimeout.unref();
    stream.on("data", (chunk: Buffer) => this.read(chunk));
    stream.on("error", () => this.close());
    stream.on("end", () => this.close());
    stream.on("close", () => this.close());
    this.send({ version: 1, kind: "hello" });
  }
  get connected(): boolean {
    return !this.closed && this.greeted;
  }

  private send(frame: z.infer<typeof frameSchema>): void {
    if (this.closed) return;
    const body = Buffer.from(JSON.stringify(frame));
    if (
      body.length > SECRET_CHANNEL_MAX_BYTES ||
      this.stream.writableLength + body.length + 4 >
        SECRET_CHANNEL_MAX_BYTES * MAX_PENDING
    ) {
      this.close();
      return;
    }
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(body.length);
    this.stream.write(Buffer.concat([prefix, body]));
  }
  private read(chunk: Buffer): void {
    if (this.closed) return;
    if (chunk.length > SECRET_CHANNEL_MAX_BYTES * MAX_PENDING) {
      this.close();
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE();
      if (size === 0 || size > SECRET_CHANNEL_MAX_BYTES) {
        this.close();
        return;
      }
      if (this.buffer.length < size + 4) break;
      let raw: unknown;
      try {
        raw = JSON.parse(this.buffer.subarray(4, size + 4).toString("utf8"));
      } catch {
        this.close();
        return;
      }
      this.buffer = this.buffer.subarray(size + 4);
      const parsed = frameSchema.safeParse(raw);
      if (!parsed.success) {
        this.close();
        return;
      }
      const frame = parsed.data;
      if (frame.kind === "hello") {
        if (this.greeted) {
          this.close();
          return;
        }
        this.greeted = true;
        clearTimeout(this.helloTimeout);
        this.readyResolve();
        continue;
      }
      if (!this.greeted) {
        this.close();
        return;
      }
      if (frame.kind === "result" || frame.kind === "error") {
        this.pending
          .get(frame.id)
          ?.finish(
            frame.kind === "error" ? frame.code : null,
            frame.kind === "result" ? frame.value : undefined,
          );
      } else if (frame.kind === "cancel") {
        this.incoming.get(frame.id)?.abort();
      } else if (frame.kind === "notice") {
        this.handlers.notice?.(frame.name, frame.value);
      } else {
        if (this.incoming.has(frame.id) || this.incoming.size >= MAX_PENDING) {
          this.close();
          return;
        }
        const controller = new AbortController();
        this.incoming.set(frame.id, controller);
        void (async () => {
          try {
            if (this.handlers.request === undefined)
              throw new SecretStorageError("invalid_request");
            const value = await this.handlers.request(
              frame.method,
              frame.payload,
              controller.signal,
            );
            if (!controller.signal.aborted)
              this.send({ version: 1, kind: "result", id: frame.id, value });
          } catch (error) {
            if (!controller.signal.aborted)
              this.send({
                version: 1,
                kind: "error",
                id: frame.id,
                code: secretStorageCode(error),
              });
          } finally {
            this.incoming.delete(frame.id);
          }
        })();
      }
    }
  }
  request(
    method: SecretChannelMethod,
    payload: unknown = null,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new SecretStorageError("unavailable"));
    if (options.signal?.aborted)
      return Promise.reject(new SecretStorageError("cancelled"));
    if (this.pending.size >= MAX_PENDING)
      return Promise.reject(new SecretStorageError("unavailable"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (code: SecretStorageCode | null, value?: unknown) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        if (code === null) resolve(value);
        else reject(new SecretStorageError(code));
      };
      const abort = () => {
        this.send({ version: 1, kind: "cancel", id });
        finish("cancelled");
      };
      const timeout = setTimeout(abort, options.timeoutMs ?? 30_000);
      timeout.unref();
      this.pending.set(id, { finish });
      options.signal?.addEventListener("abort", abort, { once: true });
      void this.ready.then(
        () => {
          if (this.pending.has(id))
            this.send({ version: 1, kind: "request", id, method, payload });
        },
        () => finish("unavailable"),
      );
    });
  }
  notify(name: SecretChannelNotice, value: boolean): void {
    void this.ready.then(
      () => this.send({ version: 1, kind: "notice", name, value }),
      () => {},
    );
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.helloTimeout);
    this.readyReject(new SecretStorageError("unavailable"));
    for (const pending of this.pending.values()) pending.finish("unavailable");
    for (const controller of this.incoming.values()) controller.abort();
    this.incoming.clear();
    this.buffer = Buffer.alloc(0);
    this.stream.destroy();
    this.handlers.close?.();
  }
}
