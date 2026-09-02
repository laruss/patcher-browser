import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import { createTerminalSession, type TerminalSessionRow } from "@patcher/db";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import type { HostDaemonServerWsMessage } from "@patcher/host-daemon-contract";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  TEST_APP_API_KEY,
  type TestAppHarness,
} from "../helpers/test-app.js";

/**
 * A terminal an agent opens, and only the ones that are its own.
 *
 * `/terminals` was refused to an agent outright while a terminal was a PTY on
 * the host outside every sandbox. It runs inside the turn's own boundary now,
 * which is what makes the route worth having back — and what makes the two
 * halves below the whole of it: a turn may open one for its own thread, and may
 * drive the ones that are confined and belong to it.
 */

type TerminalOpenMessage = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.open" }
>;

interface Fixture {
  harness: TestAppHarness;
  callerThreadId: string;
  childThreadId: string;
  strangerThreadId: string;
  environmentId: string;
  hostId: string;
  daemonSessionId: string;
  sentMessages: string[];
}

const harnesses: TestAppHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    await harnesses.pop()?.cleanup();
  }
});

async function createFixture(): Promise<Fixture> {
  const harness = await createTestAppHarness();
  harnesses.push(harness);
  const { host, session } = seedHostSession(harness.deps, {
    id: "terminal-scope-host",
  });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    path: "/tmp/terminal-workspace",
    projectId: project.id,
    status: "ready",
  });
  const seed = (parentThreadId: string | null) =>
    seedThread(harness.deps, {
      environmentId: environment.id,
      parentThreadId,
      projectId: project.id,
      status: "idle",
    });
  // The caller is an agent mid-turn, and that is now a fact the server checks:
  // a turn credential is accepted while its thread has a turn running, so a
  // fixture that left it idle would be testing an expired credential instead
  // of the terminal scope this file is about.
  const caller = seedThread(harness.deps, {
    environmentId: environment.id,
    parentThreadId: null,
    projectId: project.id,
    status: "active",
  });
  const sentMessages: string[] = [];
  harness.hub.registerDaemon(session.id, host.id, {
    close: vi.fn(() => {}),
    send: vi.fn((data: string) => {
      sentMessages.push(data);
    }),
  });
  return {
    callerThreadId: caller.id,
    childThreadId: seed(caller.id).id,
    daemonSessionId: session.id,
    environmentId: environment.id,
    harness,
    hostId: host.id,
    sentMessages,
    strangerThreadId: seed(null).id,
  };
}

function agentHeaders(threadId: string): Record<string, string> {
  return {
    [PATCHER_THREAD_ID_HEADER]: threadId,
    [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
      appApiKey: TEST_APP_API_KEY,
      threadId,
    }),
    "content-type": "application/json",
  };
}

async function waitForTerminalOpen(
  fixture: Fixture,
): Promise<TerminalOpenMessage> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    for (const raw of fixture.sentMessages) {
      const message = JSON.parse(raw) as HostDaemonServerWsMessage;
      if (message.type === "terminal.open") return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The daemon was never asked to open a terminal");
}

function openTerminalRequest(
  fixture: Fixture,
  args: { headers?: Record<string, string>; target: unknown },
): Promise<Response> {
  return Promise.resolve(
    fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: args.headers ?? { "content-type": "application/json" },
      body: JSON.stringify({ cols: 100, rows: 30, target: args.target }),
    }),
  );
}

function seedTerminalRow(
  fixture: Fixture,
  args: { sandboxed: boolean; threadId: string | null },
): TerminalSessionRow {
  return createTerminalSession(fixture.harness.deps.db, {
    cols: 100,
    daemonSessionId: fixture.daemonSessionId,
    environmentId: fixture.environmentId,
    hostId: fixture.hostId,
    initialCwd: "/tmp/terminal-workspace",
    rows: 30,
    sandboxed: args.sandboxed,
    status: "running",
    threadId: args.threadId,
    title: "zsh",
  });
}

describe("a terminal a turn's agent opens", () => {
  it("is asked for with the boundary its turn runs in", async () => {
    const fixture = await createFixture();

    void openTerminalRequest(fixture, {
      headers: agentHeaders(fixture.callerThreadId),
      target: { kind: "thread", threadId: fixture.callerThreadId },
    });

    const openMessage = await waitForTerminalOpen(fixture);
    expect(openMessage.sandbox).toEqual({ mode: "workspace" });
    expect(openMessage.threadId).toBe(fixture.callerThreadId);
  });

  it("is not confined when a person asked for it", async () => {
    const fixture = await createFixture();

    void openTerminalRequest(fixture, {
      target: { kind: "thread", threadId: fixture.callerThreadId },
    });

    // A person opening a terminal on their own machine is not something to
    // sandbox, and the daemon is told nothing rather than told "off".
    expect((await waitForTerminalOpen(fixture)).sandbox).toBeUndefined();
  });

  it("may be opened for a thread the turn spawned", async () => {
    const fixture = await createFixture();

    void openTerminalRequest(fixture, {
      headers: agentHeaders(fixture.callerThreadId),
      target: { kind: "thread", threadId: fixture.childThreadId },
    });

    expect((await waitForTerminalOpen(fixture)).sandbox).toEqual({
      mode: "workspace",
    });
  });

  it("is refused for a thread the turn did not spawn", async () => {
    const fixture = await createFixture();

    const response = await openTerminalRequest(fixture, {
      headers: agentHeaders(fixture.callerThreadId),
      target: { kind: "thread", threadId: fixture.strangerThreadId },
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("not this turn's");
    expect(fixture.sentMessages).toEqual([]);
  });

  it("is refused for a target that names no thread", async () => {
    const fixture = await createFixture();

    for (const target of [
      { kind: "environment", environmentId: fixture.environmentId },
      { kind: "host_path", hostId: fixture.hostId, cwd: "/tmp" },
    ]) {
      const response = await openTerminalRequest(fixture, {
        headers: agentHeaders(fixture.callerThreadId),
        target,
      });

      expect(response.status).toBe(403);
      // There would be no turn to take the boundary from, and a host path is
      // the shell-anywhere case this closes.
      expect(await response.text()).toContain("opens a terminal for a thread");
    }
    expect(fixture.sentMessages).toEqual([]);
  });
});

describe("driving a terminal from inside a turn", () => {
  it("is refused on one a person opened for the same thread", async () => {
    const fixture = await createFixture();
    const terminal = seedTerminalRow(fixture, {
      sandboxed: false,
      threadId: fixture.callerThreadId,
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${terminal.id}/input`,
      {
        method: "POST",
        headers: agentHeaders(fixture.callerThreadId),
        body: JSON.stringify({
          dataBase64: Buffer.from("id\n").toString("base64"),
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("outside this turn's sandbox");
  });

  it("is refused on another thread's terminal, confined or not", async () => {
    const fixture = await createFixture();
    const terminal = seedTerminalRow(fixture, {
      sandboxed: true,
      threadId: fixture.strangerThreadId,
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${terminal.id}/close`,
      {
        method: "POST",
        headers: agentHeaders(fixture.callerThreadId),
        body: JSON.stringify({ mode: "force", reason: "user" }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("not this turn's to drive");
  });

  it("is not what stops a turn on its own confined terminal", async () => {
    const fixture = await createFixture();
    const terminal = seedTerminalRow(fixture, {
      sandboxed: true,
      threadId: fixture.callerThreadId,
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${terminal.id}/input`,
      {
        method: "POST",
        headers: agentHeaders(fixture.callerThreadId),
        body: JSON.stringify({
          dataBase64: Buffer.from("id\n").toString("base64"),
        }),
      },
    );

    // What happens next is the input route's business — this asserts only that
    // the scope gate is not what stopped it.
    expect(await response.text()).not.toContain("not this turn's to drive");
  });

  it("keeps the confinement when the terminal is restarted", async () => {
    const fixture = await createFixture();
    const terminal = seedTerminalRow(fixture, {
      sandboxed: true,
      threadId: fixture.callerThreadId,
    });

    // A person's restart of an agent's terminal: the replacement must not come
    // back unconfined, or asking for one would be a way out of the turn.
    void Promise.resolve(
      fixture.harness.app.request(`/api/v1/terminals/${terminal.id}/restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect((await waitForTerminalOpen(fixture)).sandbox).toEqual({
      mode: "workspace",
    });
  });
});

describe("reading a terminal from inside a turn", () => {
  it("stays open, the way thread reads do", async () => {
    const fixture = await createFixture();
    const terminal = seedTerminalRow(fixture, {
      sandboxed: false,
      threadId: fixture.strangerThreadId,
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${terminal.id}`,
      { headers: agentHeaders(fixture.callerThreadId) },
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      id: terminal.id,
    });
  });
});
