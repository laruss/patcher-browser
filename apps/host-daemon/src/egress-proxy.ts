import { randomBytes } from "node:crypto";
import net from "node:net";

/**
 * The one way out of a network-confined turn.
 *
 * Pi and ACP are the two providers whose *own process* Patcher confines rather
 * than confining the commands it runs (see `provider-sandbox.ts`), and that is
 * exactly why their network could not simply be switched off the way Codex's
 * can: the process holding the boundary is the one that has to reach its model.
 * So the boundary is selective instead of absolute — the OS refuses every
 * outbound connection except to this proxy, and this proxy decides by hostname.
 *
 * Three things about the shape, each measured rather than assumed:
 *
 * - **`CONNECT` carries the hostname in the clear**, so nothing here terminates
 *   TLS, installs a certificate, or sees a byte of the model traffic. A tunnel
 *   is opened or it is not.
 * - **The socket is raw, not `http.createServer`.** A refusal has to be a 407
 *   the client can retry on the same connection: git's curl backend sends
 *   `CONNECT` unauthenticated, reads the challenge, and retries. Node's HTTP
 *   server hands the socket to the `connect` listener and stops parsing it, so
 *   the retry arrives at nobody and `git clone` hangs — measured, twice.
 * - **The token rides in the proxy URL's userinfo, with a non-empty password.**
 *   `http://patcher:<token>@127.0.0.1:<port>` is honored by every client
 *   measured through it — curl, git, npm, pip, Node with `--use-env-proxy`,
 *   and cursor-agent, grok, hermes and opencode's own HTTP clients. An *empty*
 *   password is not: `token:@host` makes Node's fetch fail with no usable
 *   error, which is why the secret is the password rather than the user.
 *
 * The token is what makes a grant a grant. The proxy listens on loopback, where
 * any process running as this user can reach it, so the policy cannot be a
 * property of the listener — it is a property of whoever proves they were handed
 * a launch. A sibling turn's agent cannot read another turn's environment, and
 * an unconfined process running as you already has the whole network and needs
 * nothing from here.
 *
 * A host on neither list is put to the person rather than only refused — see
 * `askAboutHost` and `answerFor`, where the interesting part is not the asking
 * but which answers are remembered.
 *
 * What this does not buy, said plainly because the alternative is implying it:
 * an allowed host that accepts arbitrary bytes is still a way off the machine.
 * `github.com` takes a push; the model API takes a prompt. What the boundary
 * removes is unattended egress to anywhere at all, and what it adds is a list
 * somebody chose, a question for what is not on it, and a record of what was
 * refused.
 */

/** How much of a request head to buffer before giving up on it. */
const MAX_HEAD_BYTES = 32 * 1024;

/** Loopback targets are allowed by the profile itself, so they are allowed here. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface EgressGrantRequest {
  /**
   * What this grant belongs to — an environment and a provider.
   *
   * Granting again under the same key replaces the policy and keeps the token,
   * which is what a re-launch or a changed allowlist wants: the new list takes
   * effect and a process still running under the old one is not cut off
   * mid-turn. It also bounds the table, which is why there is a key at all:
   * a grant is not tied to a process Patcher gets told about the end of, so
   * one per launch would only ever be added to.
   */
  key: string;
  /** Which provider the confined process belongs to, for the refusal record. */
  providerId: string;
  /** The thread whose turn this launch serves, where the launch knows one. */
  threadId?: string;
  /**
   * Hostnames this launch may reach: the provider's own declaration plus what
   * the person allowed. `*.example.com` matches subdomains, not the bare name.
   */
  allowedHosts: readonly string[];
}

export interface EgressGrant {
  /** What the confined process gets as `HTTPS_PROXY`, token included. */
  proxyUrl: string;
  /** Drops the grant; connections already tunnelled are left alone. */
  revoke: () => void;
}

export interface EgressRefusal {
  providerId: string;
  threadId?: string;
  host: string;
  port: number;
}

/**
 * What came back from putting an unlisted host to the person, and how much of
 * it is an answer.
 *
 * The three cases are here rather than folded into a boolean because they are
 * remembered differently: a decision — either way — is remembered for as long
 * as the grant lives, and "nobody answered" is not remembered at all. Caching a
 * timeout as a refusal would turn one unattended turn into a host that is
 * refused for good; not caching a decline would let an agent's retry loop put
 * the same question on screen until the person gives in.
 */
export type EgressAskOutcome =
  | { outcome: "allowed" }
  | { outcome: "declined" }
  | { outcome: "unanswered"; reason: string };

export interface EgressProxyOptions {
  /**
   * Called for every host this proxy refuses, after any question about it has
   * been answered. The daemon logs it: a refusal is otherwise visible only as
   * the agent's own connection error, so it must name who asked for what.
   */
  onRefused?: (refusal: EgressRefusal) => void;
  /**
   * Puts an unlisted host to the person whose thread this launch serves.
   *
   * Absent leaves the refusal a refusal, which is what this was before the
   * prompt existed and what a launch with no thread to ask in still gets.
   *
   * Deliberately not tied to the connection that triggered it. A client gives
   * up long before a person decides — undici stops waiting for a socket in ten
   * seconds — so the connection waits as long as it can and the *question*
   * outlives it. The answer is remembered either way, which is what makes the
   * agent's next attempt the one that goes through.
   */
  askAboutHost?: (refusal: EgressRefusal) => Promise<EgressAskOutcome>;
}

interface Grant extends EgressGrantRequest {
  matchers: readonly HostMatcher[];
}

type HostMatcher =
  | { kind: "exact"; host: string }
  | { kind: "suffix"; suffix: string };

function parseHostMatcher(pattern: string): HostMatcher | undefined {
  const normalized = pattern.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (normalized.startsWith("*.")) {
    const suffix = normalized.slice(1);
    return suffix === "." ? undefined : { kind: "suffix", suffix };
  }
  return { kind: "exact", host: normalized };
}

function matchesHost(matchers: readonly HostMatcher[], host: string): boolean {
  const normalized = host.toLowerCase();
  return matchers.some((matcher) =>
    matcher.kind === "exact"
      ? matcher.host === normalized
      : normalized.endsWith(matcher.suffix),
  );
}

/** `host:port`, an IPv6 literal included, where the port may be absent. */
function splitAuthority(
  authority: string,
  defaultPort: number,
): { host: string; port: number } {
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end > 0) {
      const host = authority.slice(1, end);
      const rest = authority.slice(end + 1);
      const port = rest.startsWith(":") ? Number(rest.slice(1)) : defaultPort;
      return { host, port: Number.isFinite(port) ? port : defaultPort };
    }
  }
  const colon = authority.lastIndexOf(":");
  if (colon <= 0) return { host: authority, port: defaultPort };
  const port = Number(authority.slice(colon + 1));
  return {
    host: authority.slice(0, colon),
    port: Number.isFinite(port) ? port : defaultPort,
  };
}

interface RequestHead {
  method: string;
  target: string;
  version: string;
  headerLines: readonly string[];
  headers: Map<string, string>;
}

function parseHead(text: string): RequestHead | undefined {
  const lines = text.split("\r\n");
  const requestLine = lines[0];
  if (requestLine === undefined) return undefined;
  const [method, target, version] = requestLine.split(" ");
  if (method === undefined || target === undefined) return undefined;
  const headerLines = lines.slice(1);
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.set(
        line.slice(0, colon).toLowerCase(),
        line.slice(colon + 1).trim(),
      );
    }
  }
  return {
    method: method.toUpperCase(),
    target,
    version: version ?? "HTTP/1.1",
    headerLines,
    headers,
  };
}

/** The token out of `Proxy-Authorization: Basic base64("patcher:<token>")`. */
function credentialOf(head: RequestHead): string | undefined {
  const header = head.headers.get("proxy-authorization");
  if (header === undefined) return undefined;
  const [scheme, value] = header.split(" ");
  if ((scheme ?? "").toLowerCase() !== "basic" || value === undefined) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    return undefined;
  }
  const separator = decoded.indexOf(":");
  return separator < 0 ? undefined : decoded.slice(separator + 1);
}

export class EgressProxy {
  private server: net.Server | undefined;
  private listeningPort: number | undefined;
  private readonly grants = new Map<string, Grant>();
  private readonly tokensByKey = new Map<string, string>();
  private starting: Promise<void> | undefined;
  private readonly sockets = new Set<net.Socket>();
  /**
   * Answers already given, per grant key, for hosts that were not on its list.
   *
   * Scoped to the grant rather than to the thread or the machine, because the
   * grant is what the boundary actually is: one token for one environment's
   * turns of one provider, held by a process several threads share. An answer
   * kept per thread would be a claim the enforcement cannot make — a sibling
   * thread's turn runs in the same process, under the same token.
   */
  private readonly decisionsByKey = new Map<
    string,
    Map<string, { allowed: boolean; reason: string }>
  >();
  /** One question per host at a time; every waiting connection joins it. */
  private readonly asking = new Map<
    string,
    Promise<{ allowed: boolean; reason: string }>
  >();

  constructor(private readonly options: EgressProxyOptions = {}) {}

  /**
   * The loopback port this listens on, once it does.
   *
   * Read by the daemon to carry it into a Linux network namespace, which has
   * no host loopback of its own: see `sandbox-loopback.ts`. A grant's proxy URL
   * names the same port, but a URL a launch is handed is not a thing to parse
   * a port back out of.
   */
  get port(): number | undefined {
    return this.listeningPort;
  }

  /**
   * Starts listening, once. The address has to exist before a launcher is
   * built, and a launcher is built inside a synchronous callback, so the
   * caller awaits this earlier — when the environment's runtime is created.
   */
  async start(): Promise<void> {
    if (this.server !== undefined) return;
    // Memoized rather than guarded on `this.server`: environments are created
    // concurrently, and two callers past a plain guard would each open a
    // listener, with the loser left running for the daemon's life. Cleared on
    // failure so a later environment can try again.
    this.starting ??= this.listen().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
  }

  private async listen(): Promise<void> {
    const server = net.createServer((socket) => this.handle(socket));
    server.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("The egress proxy did not get a loopback port.");
    }
    server.unref();
    this.server = server;
    this.listeningPort = address.port;
  }

  grant(request: EgressGrantRequest): EgressGrant {
    if (this.listeningPort === undefined) {
      throw new Error("The egress proxy is not listening yet.");
    }
    const matchers = request.allowedHosts
      .map(parseHostMatcher)
      .filter((matcher): matcher is HostMatcher => matcher !== undefined);
    const token =
      this.tokensByKey.get(request.key) ??
      randomBytes(24).toString("base64url");
    this.tokensByKey.set(request.key, token);
    this.grants.set(token, { ...request, matchers });
    return {
      proxyUrl: `http://patcher:${token}@127.0.0.1:${this.listeningPort}`,
      revoke: () => {
        this.grants.delete(token);
        this.tokensByKey.delete(request.key);
        this.decisionsByKey.delete(request.key);
      },
    };
  }

  async close(): Promise<void> {
    this.grants.clear();
    this.tokensByKey.clear();
    this.decisionsByKey.clear();
    this.asking.clear();
    this.starting = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = undefined;
    this.listeningPort = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handle(client: net.Socket): void {
    this.sockets.add(client);
    client.on("close", () => this.sockets.delete(client));
    client.on("error", () => client.destroy());
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) {
          if (buffer.length > MAX_HEAD_BYTES) client.destroy();
          return;
        }
        const head = parseHead(buffer.subarray(0, end).toString("latin1"));
        const rest = buffer.subarray(end + 4);
        if (head === undefined) {
          client.destroy();
          return;
        }
        const token = credentialOf(head);
        const grant = token === undefined ? undefined : this.grants.get(token);
        if (grant === undefined) {
          // Keep reading: the client is expected to retry on this connection
          // with the challenge answered, which is how git's proxy auth works.
          buffer = rest;
          client.write(
            "HTTP/1.1 407 Proxy Authentication Required\r\n" +
              'Proxy-Authenticate: Basic realm="Patcher"\r\n' +
              "Content-Length: 0\r\n\r\n",
          );
          continue;
        }
        client.removeListener("data", onData);
        // Removing the last `data` listener does not pause a flowing stream, it
        // drops what arrives next — a POST body, or anything a client sends
        // without waiting. Held until `pipe` resumes it on the far side.
        client.pause();
        if (head.method === "CONNECT") {
          void this.tunnel({ client, grant, head, pending: rest });
        } else {
          void this.forward({ client, grant, head, pending: rest });
        }
        return;
      }
    };
    client.on("data", onData);
  }

  /**
   * Whether this grant may reach the target — asking the person when the list
   * does not already answer it, and recording the refusal when nothing does.
   *
   * The order matters and is the whole policy: the list is checked first, so a
   * host somebody already allowed never raises a question; then the answers
   * given for this grant, so a decision is asked for once; and only then is
   * anybody interrupted.
   */
  private async decide(args: {
    grant: Grant;
    host: string;
    port: number;
  }): Promise<{ allowed: boolean; reason: string }> {
    if (LOOPBACK_HOSTNAMES.has(args.host.toLowerCase())) {
      return { allowed: true, reason: "" };
    }
    if (matchesHost(args.grant.matchers, args.host)) {
      return { allowed: true, reason: "" };
    }
    const decision = await this.answerFor(args);
    if (!decision.allowed) {
      this.options.onRefused?.({
        providerId: args.grant.providerId,
        ...(args.grant.threadId !== undefined
          ? { threadId: args.grant.threadId }
          : {}),
        host: args.host,
        port: args.port,
      });
    }
    return decision;
  }

  private answerFor(args: {
    grant: Grant;
    host: string;
    port: number;
  }): Promise<{ allowed: boolean; reason: string }> {
    const host = args.host.toLowerCase();
    const ask = this.options.askAboutHost;
    if (ask === undefined) {
      return Promise.resolve({
        allowed: false,
        reason: `${args.host} is not on this turn's allowed-hosts list`,
      });
    }
    if (args.grant.threadId === undefined) {
      // Told apart from the case above deliberately: one is a daemon that
      // cannot ask anybody anything, the other is a launch with no thread to
      // raise the question in — a maintenance runtime, or a provider process
      // started before any turn.
      return Promise.resolve({
        allowed: false,
        reason: `${args.host} is not on this turn's allowed-hosts list, and this launch has no thread to ask in`,
      });
    }
    const remembered = this.decisionsByKey.get(args.grant.key)?.get(host);
    if (remembered !== undefined) return Promise.resolve(remembered);
    const askKey = `${args.grant.key}\u0000${host}`;
    const pending = this.asking.get(askKey);
    if (pending !== undefined) return pending;

    const threadId = args.grant.threadId;
    const question = ask({
      providerId: args.grant.providerId,
      threadId,
      host: args.host,
      port: args.port,
    })
      .catch(
        (error: unknown): EgressAskOutcome => ({
          outcome: "unanswered",
          reason: `asking you failed (${error instanceof Error ? error.message : String(error)})`,
        }),
      )
      .then((answer) => {
        const decision =
          answer.outcome === "allowed"
            ? { allowed: true, reason: "" }
            : answer.outcome === "declined"
              ? {
                  allowed: false,
                  reason: `you did not allow ${args.host} for this workspace's turns`,
                }
              : {
                  allowed: false,
                  reason: `${args.host} is not on this turn's allowed-hosts list and ${answer.reason}`,
                };
        if (answer.outcome !== "unanswered") {
          const decisions =
            this.decisionsByKey.get(args.grant.key) ??
            new Map<string, { allowed: boolean; reason: string }>();
          decisions.set(host, decision);
          this.decisionsByKey.set(args.grant.key, decisions);
        }
        return decision;
      })
      .finally(() => {
        this.asking.delete(askKey);
      });
    this.asking.set(askKey, question);
    return question;
  }

  /**
   * A refusal the client can read. On a `CONNECT` the tunnel never opens, so
   * this body is the only place the reason can go — and some clients print it
   * while others report the status alone, which is why the daemon logs it too.
   */
  private refuse(args: {
    client: net.Socket;
    host: string;
    reason: string;
  }): void {
    const body =
      `Patcher refused this connection: ${args.reason}. ` +
      "Add the host in Settings, or run the thread at Full Access.\n";
    args.client.end(
      "HTTP/1.1 403 Forbidden\r\n" +
        "Content-Type: text/plain; charset=utf-8\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "Connection: close\r\n\r\n" +
        body,
    );
  }

  private async tunnel(args: {
    client: net.Socket;
    grant: Grant;
    head: RequestHead;
    pending: Buffer;
  }): Promise<void> {
    const { host, port } = splitAuthority(args.head.target, 443);
    const decision = await this.decide({ grant: args.grant, host, port });
    // The client may well have given up while a person was deciding: the
    // question is deliberately allowed to outlive the connection, so this is
    // an ordinary end rather than a failure.
    if (args.client.destroyed) return;
    if (!decision.allowed) {
      this.refuse({ client: args.client, host, reason: decision.reason });
      return;
    }
    const upstream = net.connect(port, host, () => {
      args.client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (args.pending.length > 0) upstream.write(args.pending);
      upstream.pipe(args.client);
      args.client.pipe(upstream);
    });
    upstream.on("error", () => {
      args.client.destroy();
    });
    args.client.on("error", () => upstream.destroy());
    args.client.on("close", () => upstream.destroy());
  }

  /**
   * A plain-HTTP request, rewritten from the absolute form a proxy receives to
   * the origin form a server expects, with the hop-by-hop headers dropped.
   *
   * `Connection: close` goes on deliberately: keep-alive would put a second
   * request on this socket that no policy check ever saw.
   */
  private async forward(args: {
    client: net.Socket;
    grant: Grant;
    head: RequestHead;
    pending: Buffer;
  }): Promise<void> {
    let url: URL;
    try {
      url = new URL(args.head.target);
    } catch {
      args.client.destroy();
      return;
    }
    const port = url.port === "" ? 80 : Number(url.port);
    const decision = await this.decide({
      grant: args.grant,
      host: url.hostname,
      port,
    });
    if (args.client.destroyed) return;
    if (!decision.allowed) {
      this.refuse({
        client: args.client,
        host: url.hostname,
        reason: decision.reason,
      });
      return;
    }
    const path = `${url.pathname}${url.search}`;
    const headerLines = args.head.headerLines.filter((line) => {
      const name = line.slice(0, Math.max(line.indexOf(":"), 0)).toLowerCase();
      return (
        name !== "" &&
        name !== "proxy-authorization" &&
        name !== "proxy-connection" &&
        name !== "connection"
      );
    });
    const upstream = net.connect(port, url.hostname, () => {
      upstream.write(
        `${args.head.method} ${path} ${args.head.version}\r\n` +
          [...headerLines, "Connection: close"].join("\r\n") +
          "\r\n\r\n",
      );
      if (args.pending.length > 0) upstream.write(args.pending);
      upstream.pipe(args.client);
      args.client.pipe(upstream);
    });
    upstream.on("error", () => {
      args.client.destroy();
    });
    args.client.on("error", () => upstream.destroy());
    args.client.on("close", () => upstream.destroy());
  }
}
