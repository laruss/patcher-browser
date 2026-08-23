/**
 * A plugin HTTP route as messages.
 *
 * `patcher.http.route` is one of the two callbacks that cannot cross a boundary as
 * it stands (see ./plugin-callbacks.ts): it takes a Hono `Context` and returns
 * a `Response`, and neither is data. This file is the shape they reduce to,
 * with the conversion written and tested both ways.
 *
 * **It is not applied in-process, and that is the point of writing it now.**
 * Reducing a request means reading its body, and reducing a response means
 * buffering one — a cost worth paying once there is a boundary to pay it for,
 * and pure waste while the handler is a function call away. What is worth
 * having before then is the conversion itself, proven against the cases that
 * break a naive version: headers that repeat, bodies that are bytes rather
 * than text, and responses that stream.
 *
 * The cost is therefore stated rather than discovered: **a plugin's streaming
 * response stops streaming** the day this is applied. Nothing in-tree streams
 * one today, which is why that is an acceptable price and not a blocker — but
 * it is a contract change for plugin authors and belongs in the release notes
 * of whichever version turns it on.
 */

/** A request, reduced to what a transport can carry. */
export interface PluginHttpRequestMessage {
  method: string;
  /** Absolute, so the far side can rebuild query and path without a base. */
  url: string;
  /**
   * Header entries rather than a record: `set-cookie` and `accept` legally
   * repeat, and a record silently keeps the last one.
   */
  headers: ReadonlyArray<readonly [name: string, value: string]>;
  /** Base64, because a body is bytes — JSON cannot hold them any other way. */
  body: string | null;
}

/** A response, reduced the same way. */
export interface PluginHttpResponseMessage {
  status: number;
  /** Preserved because a plugin may set one and clients do read it. */
  statusText: string;
  headers: ReadonlyArray<readonly [name: string, value: string]>;
  body: string | null;
}

function headerEntries(headers: Headers): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  // Repeated ordinary headers come out of the iterator comma-joined
  // (`accept: a, b`), which is their correct wire form and rebuilds
  // identically — nothing is lost there.
  //
  // `set-cookie` is the exception that matters: joining two cookies produces
  // one unusable header. Implementations differ on whether the iterator
  // separates it, so it is skipped here and taken from `getSetCookie()`
  // instead of trusted to come out right.
  for (const [name, value] of headers) {
    if (name.toLowerCase() === "set-cookie") continue;
    entries.push([name, value]);
  }
  for (const cookie of headers.getSetCookie?.() ?? []) {
    entries.push(["set-cookie", cookie]);
  }
  return entries;
}

function toHeaders(entries: ReadonlyArray<readonly [string, string]>): Headers {
  const headers = new Headers();
  for (const [name, value] of entries) headers.append(name, value);
  return headers;
}

async function encodeBody(source: Request | Response): Promise<string | null> {
  if (source.body === null) return null;
  const bytes = new Uint8Array(await source.arrayBuffer());
  return bytes.length === 0 ? null : Buffer.from(bytes).toString("base64");
}

function decodeBody(body: string | null): ArrayBuffer | null {
  if (body === null) return null;
  const buffer = Buffer.from(body, "base64");
  // Sliced out of Buffer's shared pool: handing over the pool's backing store
  // would expose whatever else it holds, and `BodyInit` takes an ArrayBuffer.
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/**
 * Reduce a request. Consumes the body, so callers with a live request pass a
 * `clone()` — the in-process path has no reason to call this at all.
 */
export async function reduceHttpRequest(
  request: Request,
): Promise<PluginHttpRequestMessage> {
  return {
    method: request.method,
    url: request.url,
    headers: headerEntries(request.headers),
    body: await encodeBody(request),
  };
}

export function rebuildHttpRequest(message: PluginHttpRequestMessage): Request {
  const body = decodeBody(message.body);
  return new Request(message.url, {
    method: message.method,
    headers: toHeaders(message.headers),
    ...(body === null ? {} : { body }),
  });
}

/**
 * Whether a plugin route's return value is a `Response`, asked structurally.
 *
 * `instanceof Response` is **not** a usable test in this process, and the way
 * that was found is worth keeping: an intermittent suite failure whose real
 * cause is that `@hono/node-server` replaces `globalThis.Response` with a
 * lightweight class of its own (`getRequestListener`, unless
 * `overrideGlobalObjects: false`). It replaces it more than once — importing
 * the package installs one class and `serve()` installs another — so after the
 * server is listening:
 *
 *     Response.json({}) instanceof Response   // false
 *     new Response("x")  instanceof Response  // true
 *
 * because the inherited static still builds with the class that was global
 * when it was captured. A plugin returning `Response.json(...)` — the obvious
 * way to answer with JSON — was therefore rejected as "not a Response".
 *
 * Same rule as errors crossing the plugin boundary by name rather than by
 * class: nothing here may depend on class identity.
 */
export function isResponseLike(value: unknown): value is Response {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Response>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.headers === "object" &&
    candidate.headers !== null
  );
}

export async function reduceHttpResponse(
  response: Response,
): Promise<PluginHttpResponseMessage> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: headerEntries(response.headers),
    body: await encodeBody(response),
  };
}

export function rebuildHttpResponse(
  message: PluginHttpResponseMessage,
): Response {
  return new Response(decodeBody(message.body), {
    status: message.status,
    statusText: message.statusText,
    headers: toHeaders(message.headers),
  });
}
