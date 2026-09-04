import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EgressProxy,
  type EgressAskOutcome,
  type EgressRefusal,
} from "./egress-proxy.js";

/**
 * The proxy a network-confined provider process is left with.
 *
 * These speak to a real listener over a real socket rather than calling the
 * parsing functions, because the two things that broke in measurement were both
 * protocol behaviour, not logic: a 407 that closed the connection hung `git
 * clone`, and a proxy URL with an empty password made Node's fetch fail. What a
 * unit test can hold is the first of those, and it does.
 *
 * A tunnel to a host that is not loopback cannot be completed here — there is
 * no name to resolve and nowhere to reach — so the policy is measured by what
 * the proxy answers: a refusal is a 403 it writes itself, while an allowed host
 * gets no answer at all until the upstream connection settles. The loopback
 * tunnel is measured end to end, bytes included, because loopback is the one
 * upstream a test can really have.
 *
 * Which is why every proxy here is given `sandboxHasPrivateLoopback`
 * explicitly, rather than letting it default to the platform. Whether a
 * loopback target is refused is a fact about the sandbox's network namespace,
 * so a suite that left it to `process.platform` would measure one rule on a
 * developer's Mac and the other on CI, and the tunnel tests would only have an
 * upstream on one of them. `startProxy` pins it to the single-loopback answer,
 * the way macOS runs; the tests about the refusal pin the other and say so.
 */

const proxies: EgressProxy[] = [];
const servers: net.Server[] = [];
const sockets: net.Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
  for (const proxy of proxies.splice(0)) await proxy.close();
});

async function startProxy(
  onRefused?: (refusal: EgressRefusal) => void,
  askAboutHost?: (refusal: EgressRefusal) => Promise<EgressAskOutcome>,
): Promise<EgressProxy> {
  const proxy = new EgressProxy({
    sandboxHasPrivateLoopback: false,
    ...(onRefused ? { onRefused } : {}),
    ...(askAboutHost ? { askAboutHost } : {}),
  });
  proxies.push(proxy);
  await proxy.start();
  return proxy;
}

/** An upstream that answers anything with a fixed line, on loopback. */
async function startUpstream(reply: string): Promise<number> {
  const server = net.createServer((socket) => {
    socket.on("data", () => socket.end(reply));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

function parseProxyUrl(proxyUrl: string): { port: number; token: string } {
  const url = new URL(proxyUrl);
  return { port: Number(url.port), token: decodeURIComponent(url.password) };
}

/**
 * Speaks to the proxy directly: the request head, then whatever comes back
 * until the socket is idle. Written by hand because the point is the exact
 * bytes on the wire, including a retry on the same connection.
 */
async function speak(args: {
  port: number;
  requests: readonly string[];
  /** Wait this long for more bytes after the last one arrived. */
  quietMs?: number;
}): Promise<string> {
  const socket = net.connect(args.port, "127.0.0.1");
  sockets.push(socket);
  let received = "";
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", resolve);
  });
  for (const request of args.requests) {
    socket.write(request);
    await new Promise((resolve) => setTimeout(resolve, args.quietMs ?? 150));
  }
  received += socket.read()?.toString() ?? "";
  // `read()` only returns what has arrived; drain whatever the writes produced.
  for (;;) {
    const chunk = socket.read();
    if (chunk === null) break;
    received += String(chunk);
  }
  return received;
}

function connectRequest(host: string, token?: string): string {
  const auth =
    token === undefined
      ? ""
      : `Proxy-Authorization: Basic ${Buffer.from(`patcher:${token}`).toString("base64")}\r\n`;
  return `CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n${auth}\r\n`;
}

describe("a connection with no grant behind it", () => {
  it("is challenged, and the retry on the same connection is answered", async () => {
    const proxy = await startProxy();
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        allowedHosts: ["api2.cursor.sh"],
      }).proxyUrl,
    );
    const upstream = await startUpstream("upstream-said-hello");

    // The shape git's curl backend uses: CONNECT with no credential, read the
    // challenge, retry on the same socket. Closing after the 407 is what hung
    // `git clone` in measurement, so this asserts both halves at once.
    const conversation = await speak({
      port,
      requests: [
        connectRequest(`127.0.0.1:${upstream}`),
        connectRequest(`127.0.0.1:${upstream}`, token),
        "GET / HTTP/1.1\r\nHost: x\r\n\r\n",
      ],
    });

    expect(conversation).toContain("407 Proxy Authentication Required");
    expect(conversation).toContain('Proxy-Authenticate: Basic realm="Patcher"');
    expect(conversation).toContain("200 Connection Established");
    expect(conversation).toContain("upstream-said-hello");
  });

  it("is challenged again when the token is not one this proxy handed out", async () => {
    const proxy = await startProxy();
    const { port } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        allowedHosts: ["api2.cursor.sh"],
      }).proxyUrl,
    );

    const conversation = await speak({
      port,
      requests: [connectRequest("api2.cursor.sh:443", "not-a-real-token")],
    });

    expect(conversation).toContain("407 Proxy Authentication Required");
  });
});

describe("what a grant may reach", () => {
  it("refuses a host nobody listed, and says which one", async () => {
    const refusals: EgressRefusal[] = [];
    const proxy = await startProxy((refusal) => refusals.push(refusal));
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        threadId: "t1",
        allowedHosts: ["api2.cursor.sh"],
      }).proxyUrl,
    );

    const conversation = await speak({
      port,
      requests: [connectRequest("evil.example.com:443", token)],
    });

    expect(conversation).toContain("403 Forbidden");
    expect(conversation).toContain("evil.example.com");
    // The agent's own error may carry only a status, so the daemon's record is
    // the other half of this: it has to name who asked for what.
    expect(refusals).toEqual([
      {
        providerId: "acp-cursor",
        threadId: "t1",
        host: "evil.example.com",
        port: 443,
      },
    ]);
  });

  it("lets a listed host through to its upstream", async () => {
    const proxy = await startProxy();
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        // 203.0.113.0/24 is TEST-NET-3: reserved, unroutable, and so a stand-in
        // for "a host this test may not really reach". What is being measured
        // is that the proxy did not answer 403 — it went to connect instead.
        allowedHosts: ["203.0.113.1"],
      }).proxyUrl,
    );

    const conversation = await speak({
      port,
      requests: [connectRequest("203.0.113.1:443", token)],
    });

    expect(conversation).toBe("");
  });

  it("matches subdomains for a wildcard, and not the bare name", async () => {
    const refusals: EgressRefusal[] = [];
    const proxy = await startProxy((refusal) => refusals.push(refusal));
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        allowedHosts: ["*.githubusercontent.com"],
      }).proxyUrl,
    );

    const allowed = await speak({
      port,
      requests: [connectRequest("raw.githubusercontent.com:443", token)],
    });
    const refused = await speak({
      port,
      requests: [connectRequest("githubusercontent.com:443", token)],
    });

    expect(allowed).not.toContain("403");
    expect(refused).toContain("403 Forbidden");
    expect(refusals.map((refusal) => refusal.host)).toEqual([
      "githubusercontent.com",
    ]);
  });

  it("leaves loopback alone, because the profile does", async () => {
    const proxy = await startProxy();
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        allowedHosts: [],
      }).proxyUrl,
    );
    const upstream = await startUpstream("local-service");

    // A client that ignores NO_PROXY sends its own loopback traffic here —
    // measured on opencode, which talks to its own server, and on Pi, whose
    // client ignores it outright. Where there is one loopback, refusing that
    // would break the agent and close nothing: the profile already lets the
    // confined process reach it directly.
    const conversation = await speak({
      port,
      requests: [
        connectRequest(`127.0.0.1:${upstream}`, token),
        "GET / HTTP/1.1\r\nHost: x\r\n\r\n",
      ],
    });

    expect(conversation).toContain("200 Connection Established");
    expect(conversation).toContain("local-service");
  });

  it("refuses loopback where the sandbox keeps a loopback of its own", async () => {
    // The Linux answer, and the defect: this proxy runs in the daemon, outside
    // the launch's network namespace, so the socket it opens lands on the
    // *host's* loopback — every local service the relay was built to withhold,
    // reached through the one host the list never had to name.
    const proxy = new EgressProxy({ sandboxHasPrivateLoopback: true });
    proxies.push(proxy);
    await proxy.start();
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        // On the list, which is the direction that matters: the setting behind
        // it is the user's to edit, so a rule that honoured the list would be
        // one typo from being off.
        allowedHosts: ["127.0.0.1"],
      }).proxyUrl,
    );
    const upstream = await startUpstream("host-service");

    const conversation = await speak({
      port,
      requests: [
        connectRequest(`127.0.0.1:${upstream}`, token),
        "GET / HTTP/1.1\r\nHost: x\r\n\r\n",
      ],
    });

    expect(conversation).toContain("403");
    expect(conversation).toContain("network namespace");
    expect(conversation).not.toContain("200 Connection Established");
    expect(conversation).not.toContain("host-service");
  });

  it("refuses the other spellings of the same address, and asks nobody", async () => {
    // The spelling is the easy part to vary, so the rule is about the address:
    // `getaddrinfo` reads all of these as 127.0.0.1 or as another loopback,
    // and a check that only knew the dotted quad would be one somebody writes
    // their way around. `askAboutHost` is given and must go uncalled — a
    // question about loopback is one nobody can answer usefully.
    const askAboutHost = vi.fn(async () => ({ outcome: "allowed" }) as const);
    const proxy = new EgressProxy({
      sandboxHasPrivateLoopback: true,
      askAboutHost,
    });
    proxies.push(proxy);
    await proxy.start();
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        threadId: "thread-1",
        allowedHosts: [],
      }).proxyUrl,
    );

    for (const target of [
      "127.0.0.2:8080",
      "127.1:8080",
      "2130706433:8080",
      "0x7f000001:8080",
      "0.0.0.0:8080",
      "[::1]:8080",
      "[::ffff:127.0.0.1]:8080",
      "anything.localhost:8080",
    ]) {
      const conversation = await speak({
        port,
        requests: [connectRequest(target, token)],
      });
      expect(conversation, target).toContain("403");
      expect(conversation, target).toContain("network namespace");
    }
    expect(askAboutHost).not.toHaveBeenCalled();
  });

  it("keeps what a client sends before the tunnel is open", async () => {
    const proxy = await startProxy();
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env acp-cursor",
        providerId: "acp-cursor",
        allowedHosts: [],
      }).proxyUrl,
    );
    const upstream = await startUpstream("upstream-got-it");

    // Two writes with nothing between them: the second lands while the upstream
    // connection is still being made. A stream left flowing with no listener
    // drops those bytes rather than buffering them, which is a POST body gone.
    const conversation = await speak({
      port,
      requests: [
        connectRequest(`127.0.0.1:${upstream}`, token) +
          "GET / HTTP/1.1\r\nHost: x\r\n\r\n",
      ],
    });

    expect(conversation).toContain("200 Connection Established");
    expect(conversation).toContain("upstream-got-it");
  });

  it("applies the same list to a plain HTTP request", async () => {
    const proxy = await startProxy();
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env\u0000acp-cursor",
        providerId: "acp-cursor",
        allowedHosts: ["api2.cursor.sh"],
      }).proxyUrl,
    );

    const conversation = await speak({
      port,
      requests: [
        `GET http://evil.example.com/x HTTP/1.1\r\nHost: evil.example.com\r\n` +
          `Proxy-Authorization: Basic ${Buffer.from(`patcher:${token}`).toString("base64")}\r\n\r\n`,
      ],
    });

    expect(conversation).toContain("403 Forbidden");
    expect(conversation).toContain("evil.example.com");
  });
});

describe("a host nobody listed, put to the person", () => {
  /** Records every question, and answers each host the way the test says. */
  function asker(answers: Record<string, EgressAskOutcome>) {
    const asked: string[] = [];
    return {
      asked,
      ask: async (refusal: EgressRefusal): Promise<EgressAskOutcome> => {
        asked.push(refusal.host);
        return (
          answers[refusal.host] ?? {
            outcome: "unanswered" as const,
            reason: "the test said nothing about this host",
          }
        );
      },
    };
  }

  it("lets the connection through when the answer is yes", async () => {
    const { asked, ask } = asker({
      "newly-allowed.example.com": { outcome: "allowed" },
    });
    const proxy = await startProxy(undefined, ask);
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env acp-cursor",
        providerId: "acp-cursor",
        threadId: "t1",
        allowedHosts: [],
      }).proxyUrl,
    );

    const conversation = await speak({
      port,
      requests: [connectRequest("newly-allowed.example.com:443", token)],
    });

    // Same convention as the listed-host test above: this name resolves to
    // nothing, so what an allow looks like is the *absence* of a refusal — the
    // proxy went to connect instead of answering 403 itself.
    expect(asked).toEqual(["newly-allowed.example.com"]);
    expect(conversation).not.toContain("403");
  });

  it("refuses when the answer is no, and says the person said so", async () => {
    const refusals: EgressRefusal[] = [];
    const { asked, ask } = asker({
      "evil.example.com": { outcome: "declined" },
    });
    const proxy = await startProxy((refusal) => refusals.push(refusal), ask);
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env acp-cursor",
        providerId: "acp-cursor",
        threadId: "t1",
        allowedHosts: [],
      }).proxyUrl,
    );

    const conversation = await speak({
      port,
      requests: [connectRequest("evil.example.com:443", token)],
    });

    expect(asked).toEqual(["evil.example.com"]);
    expect(conversation).toContain("403 Forbidden");
    expect(conversation).toContain("you did not allow evil.example.com");
    // A decline is still a refusal in the record: the log is where somebody
    // goes to find out what a turn wanted, answer or no answer.
    expect(refusals).toHaveLength(1);
  });

  it("asks once for a host, however many connections want it", async () => {
    const { asked, ask } = asker({
      "evil.example.com": { outcome: "declined" },
    });
    const proxy = await startProxy(undefined, ask);
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env acp-cursor",
        providerId: "acp-cursor",
        threadId: "t1",
        allowedHosts: [],
      }).proxyUrl,
    );

    // Two attempts in flight at once, then a third after both answered: the
    // first two join one question, and the third reads the answer. Without
    // both halves an agent's retry loop would put the same prompt on screen
    // until somebody gave in.
    const [first, second] = await Promise.all([
      speak({
        port,
        requests: [connectRequest("evil.example.com:443", token)],
      }),
      speak({
        port,
        requests: [connectRequest("evil.example.com:443", token)],
      }),
    ]);
    const third = await speak({
      port,
      requests: [connectRequest("evil.example.com:443", token)],
    });

    expect(asked).toEqual(["evil.example.com"]);
    expect(first).toContain("403 Forbidden");
    expect(second).toContain("403 Forbidden");
    expect(third).toContain("403 Forbidden");
  });

  it("asks again when nobody answered, because that is not a decision", async () => {
    const { asked, ask } = asker({
      "evil.example.com": {
        outcome: "unanswered",
        reason: "the question went unanswered for four minutes",
      },
    });
    const proxy = await startProxy(undefined, ask);
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env acp-cursor",
        providerId: "acp-cursor",
        threadId: "t1",
        allowedHosts: [],
      }).proxyUrl,
    );

    const first = await speak({
      port,
      requests: [connectRequest("evil.example.com:443", token)],
    });
    const second = await speak({
      port,
      requests: [connectRequest("evil.example.com:443", token)],
    });

    // Remembering a timeout would turn one unattended turn into a host refused
    // for good, so the next connection asks again — and the reason travels to
    // the client, which is where a person reads it.
    expect(asked).toEqual(["evil.example.com", "evil.example.com"]);
    expect(first).toContain("unanswered for four minutes");
    expect(second).toContain("403 Forbidden");
  });

  it("keeps the answer when the client that asked has given up", async () => {
    const answer = { resolve: (_outcome: EgressAskOutcome) => {} };
    const asked: string[] = [];
    const proxy = await startProxy(undefined, async (refusal) => {
      asked.push(refusal.host);
      return await new Promise<EgressAskOutcome>((resolve) => {
        answer.resolve = resolve;
      });
    });
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env acp-cursor",
        providerId: "acp-cursor",
        threadId: "t1",
        allowedHosts: [],
      }).proxyUrl,
    );

    // An agent's client gives up in seconds and a person takes minutes, so the
    // question has to outlive the connection that raised it. This is that: the
    // socket is destroyed while the question is open, the answer arrives
    // afterwards, and the next attempt reads it instead of asking again.
    const abandoned = net.connect(port, "127.0.0.1");
    sockets.push(abandoned);
    await new Promise<void>((resolve) => abandoned.once("connect", resolve));
    abandoned.write(connectRequest("newly-allowed.example.com:443", token));
    await vi.waitFor(() =>
      expect(asked).toEqual(["newly-allowed.example.com"]),
    );
    abandoned.destroy();
    answer.resolve({ outcome: "allowed" });

    const conversation = await speak({
      port,
      requests: [connectRequest("newly-allowed.example.com:443", token)],
    });

    expect(asked).toEqual(["newly-allowed.example.com"]);
    expect(conversation).not.toContain("403");
  });

  it("cannot ask when the launch has no thread, and says which it is", async () => {
    const { asked, ask } = asker({});
    const proxy = await startProxy(undefined, ask);
    const { port, token } = parseProxyUrl(
      proxy.grant({
        key: "env acp-cursor",
        providerId: "acp-cursor",
        allowedHosts: [],
      }).proxyUrl,
    );

    const conversation = await speak({
      port,
      requests: [connectRequest("evil.example.com:443", token)],
    });

    expect(asked).toEqual([]);
    expect(conversation).toContain("no thread to ask in");
  });

  it("forgets what was answered when the grant is revoked", async () => {
    const { asked, ask } = asker({
      "evil.example.com": { outcome: "declined" },
    });
    const proxy = await startProxy(undefined, ask);
    const grant = proxy.grant({
      key: "env acp-cursor",
      providerId: "acp-cursor",
      threadId: "t1",
      allowedHosts: [],
    });
    const { port, token } = parseProxyUrl(grant.proxyUrl);

    await speak({
      port,
      requests: [connectRequest("evil.example.com:443", token)],
    });
    grant.revoke();
    const regranted = proxy.grant({
      key: "env acp-cursor",
      providerId: "acp-cursor",
      threadId: "t2",
      allowedHosts: [],
    });
    await speak({
      port,
      requests: [
        connectRequest(
          "evil.example.com:443",
          parseProxyUrl(regranted.proxyUrl).token,
        ),
      ],
    });

    // The answer belongs to the grant, so a grant that is gone takes it with
    // it: the next turn's person is asked rather than held to a decision they
    // may not have made.
    expect(asked).toEqual(["evil.example.com", "evil.example.com"]);
  });
});

describe("starting", () => {
  it("opens one listener however many environments ask at once", async () => {
    // Environments are created concurrently, and a plain `if (server)` guard
    // lets two callers each open one: the last assignment wins and the losers
    // keep their sockets for the daemon's life. Counted at `createServer`,
    // because the leak is invisible from the outside — every caller reads the
    // same port off the winner.
    const createServer = vi.spyOn(net, "createServer");
    try {
      const proxy = new EgressProxy();
      proxies.push(proxy);
      await Promise.all([proxy.start(), proxy.start(), proxy.start()]);
      await proxy.start();

      expect(createServer).toHaveBeenCalledTimes(1);
    } finally {
      createServer.mockRestore();
    }
  });
});

describe("a grant", () => {
  it("keeps its token when the same key is granted again", async () => {
    const proxy = await startProxy();
    const first = proxy.grant({
      key: "env\u0000acp-cursor",
      providerId: "acp-cursor",
      allowedHosts: ["api2.cursor.sh"],
    });
    const second = proxy.grant({
      key: "env\u0000acp-cursor",
      providerId: "acp-cursor",
      allowedHosts: ["api2.cursor.sh", "github.com"],
    });

    // A re-launch and a changed list are the same event here: the new policy
    // applies, and a process still running under the old one keeps working.
    expect(second.proxyUrl).toBe(first.proxyUrl);
  });

  it("gives a different provider a different token", async () => {
    const proxy = await startProxy();
    const cursor = proxy.grant({
      key: "env\u0000acp-cursor",
      providerId: "acp-cursor",
      allowedHosts: ["api2.cursor.sh"],
    });
    const hermes = proxy.grant({
      key: "env\u0000acp-hermes",
      providerId: "acp-hermes",
      allowedHosts: ["hermes-agent.nousresearch.com"],
    });

    expect(cursor.proxyUrl).not.toBe(hermes.proxyUrl);
  });

  it("is refused once revoked", async () => {
    const proxy = await startProxy();
    const grant = proxy.grant({
      key: "env\u0000acp-cursor",
      providerId: "acp-cursor",
      allowedHosts: ["api2.cursor.sh"],
    });
    const { port, token } = parseProxyUrl(grant.proxyUrl);
    grant.revoke();

    const conversation = await speak({
      port,
      requests: [connectRequest("api2.cursor.sh:443", token)],
    });

    expect(conversation).toContain("407 Proxy Authentication Required");
  });
});
