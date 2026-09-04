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

/**
 * Whether a target names this machine's own loopback.
 *
 * Loopback was allowed here unconditionally, ahead of the list, on the
 * reasoning that the sandbox lets a confined process reach loopback directly
 * so proxying it changes nothing. That is true on macOS and backwards on
 * Linux. This proxy runs in the daemon, **outside** the sandbox, and a socket
 * opened from here lands on the daemon's loopback — so where a confined launch
 * has a network namespace of its own, `CONNECT 127.0.0.1:<port>` reached every
 * local service the relay was built to withhold, and the "only the ports
 * Patcher mirrored" claim held against well-behaved clients alone. It was
 * wrong on its own terms too: an agent that runs a server inside the namespace
 * — opencode does — and routes through the proxy reached the host's port of
 * that number instead of its own. Which platform is which is
 * `sandboxHasPrivateLoopback`.
 *
 * By address rather than by spelling, because the spelling is the easy part to
 * vary: `127.0.0.2`, `127.1`, `2130706433`, `0x7f000001`, `0.0.0.0` and
 * `::ffff:127.0.0.1` all arrive where `127.0.0.1` does. What this cannot see is
 * a *name* that resolves to loopback; that one stays where it lands, behind the
 * list like any other name, and `docs/security.md` says so.
 */
function isLoopbackTarget(host: string): boolean {
  const bare = host
    .replace(/^\[|\]$/gu, "")
    .replace(/%.*$/u, "")
    .toLowerCase();
  // The absolute DNS spelling, and only for the *name*: `localhost.` resolves
  // the way `localhost` does, while `127.0.0.1.` is not an address at all —
  // the trailing dot takes it out of the numeric grammar, so `getaddrinfo`
  // resolves it as a name. Stripping the dot before the parsers made it 127/8.
  const named = bare.replace(/\.$/u, "");
  // An empty host is not nothing: `net.connect` reads it as localhost.
  if (named === "" || named === "localhost" || named.endsWith(".localhost")) {
    return true;
  }
  const embedded = bare.includes(":")
    ? embeddedIpv4OfIpv6(bare)
    : parseIpv4Address(bare);
  if (embedded === undefined) return false;
  // 127/8 is loopback by name, and the unspecified address is here because
  // `connect` to it goes to loopback rather than nowhere — measured on
  // `0.0.0.0`, which reached a listener on 127.0.0.1. Only the address that is
  // *all* zero: `0.0.0.1` is neither, and reading the first octet alone
  // refused a quarter of a million addresses that are not this machine.
  return embedded >>> 24 === 127 || embedded === 0;
}

/**
 * The IPv4 address an IPv6 literal stands for, where it stands for one.
 *
 * Three of the eight-group forms name this machine or an IPv4 address, and
 * nothing else does: `::` is unspecified, `::1` is loopback, and `::ffff:a.b.c.d`
 * — which Node's URL parser writes as `::ffff:7f00:1` — carries an IPv4 address
 * in the last two groups. Everything else answers `undefined`.
 *
 * Written as a parser because the shortcuts are wrong in both directions: the
 * part after the last colon is not an IPv4 address (`2001:db8::1` ends in `:1`
 * and belongs to somebody), and a pattern loose enough to catch `0:0:…:1`
 * catches `1::` with it.
 */
function embeddedIpv4OfIpv6(address: string): number | undefined {
  const groups = parseIpv6Groups(address);
  if (groups === undefined) return undefined;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (g0 !== 0 || g1 !== 0 || g2 !== 0 || g3 !== 0 || g4 !== 0) {
    return undefined;
  }
  if (g5 === 0xffff) return (((g6 ?? 0) << 16) | (g7 ?? 0)) >>> 0;
  if (g5 !== 0 || g6 !== 0) return undefined;
  // `::` and `::1`, and the same two written in full, answered as the IPv4
  // address of the same name — `0.0.0.0` and `127.0.0.1` — because that is what
  // the caller then compares. Returning the group itself made `::1` answer 1,
  // which is neither, and the address slipped through.
  if (g7 === 0) return 0;
  return g7 === 1 ? 0x7f000001 : undefined;
}

/** An IPv6 literal as its eight groups, or undefined when it is not one. */
function parseIpv6Groups(address: string): number[] | undefined {
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const parseSide = (side: string, isTail: boolean): number[] | undefined => {
    if (side === "") return [];
    const groups: number[] = [];
    const parts = side.split(":");
    for (const [index, part] of parts.entries()) {
      // A dotted quad ends the whole literal, so it belongs to the last group
      // of the *last* half: `0.0.0.0::` has one in the head, which the strict
      // grammar rejects and this read as the unspecified address.
      if (part.includes(".")) {
        if (!isTail || index !== parts.length - 1) return undefined;
        const packed = parseDottedQuad(part);
        if (packed === undefined) return undefined;
        groups.push(packed >>> 16, packed & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/u.test(part)) return undefined;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };
  const head = parseSide(halves[0] ?? "", halves.length === 1);
  const tail = halves.length === 2 ? parseSide(halves[1] ?? "", true) : [];
  if (head === undefined || tail === undefined) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const filler = 8 - head.length - tail.length;
  if (filler < 1) return undefined;
  return [...head, ...Array.from({ length: filler }, () => 0), ...tail];
}

/** The strict four-part form, which is all an IPv6 literal may embed. */
function parseDottedQuad(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    // `inet_pton` is the strict one, and it is what parses the embedded form:
    // no leading zeros, so `::ffff:127.0.0.01` is a name rather than this
    // machine written oddly.
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return undefined;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/**
 * IPv4 in every form `connect` accepts, not only the dotted quad.
 *
 * `getaddrinfo` takes the historical short and packed forms — `127.1` and
 * `2130706433` are both `127.0.0.1`, a leading `0x` is hexadecimal and a
 * leading `0` is octal — so a check that only understood four decimal parts
 * would be a check somebody writes their way around.
 *
 * The ranges are checked rather than assumed, and that is the half that keeps
 * this from over-refusing: a part out of range makes the whole thing an invalid
 * address, which Linux then resolves as a *name*. So `127.0.0.256` and
 * `4294967296` are names here, not addresses, and answering `undefined` for
 * them is the difference between refusing this machine and refusing somebody's
 * hostname.
 */
function parseIpv4Address(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length === 0 || parts.length > 4) return undefined;
  const numbers: number[] = [];
  for (const part of parts) {
    const value = parseNumericPart(part);
    if (value === undefined) return undefined;
    numbers.push(value);
  }
  // The last part carries whatever the dots left out — one part is the whole
  // address, two are `a.bbb`, and so on — so its range is the one that widens.
  const leading = numbers.slice(0, -1);
  const last = numbers.at(-1) ?? 0;
  if (leading.some((number) => number > 255)) return undefined;
  if (last >= 2 ** (8 * (4 - leading.length))) return undefined;
  let value = last;
  for (const [index, number] of leading.entries()) {
    value += number * 2 ** (8 * (3 - index));
  }
  return value >>> 0;
}

/**
 * One part of an IPv4 address, in decimal, octal or hexadecimal.
 *
 * A leading zero *selects* the octal grammar rather than suggesting it, so
 * `08` is not eight — it is not a number at all, which makes the whole target
 * a name. Falling through to the decimal branch read `127.0.0.08` as this
 * machine and refused a hostname.
 */
function parseNumericPart(part: string): number | undefined {
  const value = /^0x[0-9a-f]+$/u.test(part)
    ? Number.parseInt(part.slice(2), 16)
    : /^0[0-9]/u.test(part)
      ? /^0[0-7]+$/u.test(part)
        ? Number.parseInt(part.slice(1), 8)
        : Number.NaN
      : /^[0-9]+$/u.test(part)
        ? Number.parseInt(part, 10)
        : Number.NaN;
  return Number.isSafeInteger(value) ? value : undefined;
}

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
  /**
   * Whether a confined launch's loopback is its own rather than this one.
   *
   * The answer is the platform's and decides what a `CONNECT 127.0.0.1:<port>`
   * means here — see `isLoopbackTarget`. On Linux a confined launch has a
   * network namespace of its own, so this proxy's loopback is the *daemon's*
   * and tunnelling to it is a way past the relay's mirrored ports; on macOS
   * there is one loopback and the Seatbelt profile already lets the confined
   * process reach it directly, so refusing here would take away nothing and
   * break every client that ignores `NO_PROXY` — Pi's does, measured.
   *
   * Defaults to the platform this daemon runs on. Given explicitly by the
   * suite, which needs both answers: one to exercise the refusal, and one to
   * have an upstream at all, because every server a test can start is on
   * loopback.
   */
  sandboxHasPrivateLoopback?: boolean;
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
  private hasPrivateLoopback(): boolean {
    return (
      this.options.sandboxHasPrivateLoopback ?? process.platform === "linux"
    );
  }

  private async decide(args: {
    grant: Grant;
    host: string;
    port: number;
  }): Promise<{ allowed: boolean; reason: string }> {
    if (isLoopbackTarget(args.host)) {
      // Ahead of the list in both directions, because on neither platform is
      // this a question for a list or for a person. Where the sandbox keeps a
      // loopback of its own the answer is no, whatever anybody put on the
      // list — the loopback this proxy can dial is not the one the caller
      // means, so allowing it would be answering a different question. Where
      // there is one loopback the answer is yes, because the profile already
      // allows it directly and a refusal here would only break the clients
      // that route it through a proxy.
      if (!this.hasPrivateLoopback()) return { allowed: true, reason: "" };
      return {
        allowed: false,
        reason:
          `${args.host} is loopback, and this proxy runs outside the sandbox's ` +
          "own network namespace: a tunnel to it would reach the host's services " +
          "rather than this turn's. Reach loopback directly instead — NO_PROXY names it.",
      };
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
