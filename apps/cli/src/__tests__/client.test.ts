import { afterEach, describe, expect, it, vi } from "vitest";
import { PATCHER_THREAD_ID_HEADER } from "@patcher/server-contract";
import { cliFetch } from "../client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cliFetch", () => {
  it("delegates requests without injecting daemon credentials", async () => {
    // Stubbed rather than assumed: a developer running the suite from inside a
    // Patcher thread has PATCHER_THREAD_ID set, and this case is about its
    // absence.
    vi.stubEnv("PATCHER_THREAD_ID", "");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const init = { headers: { "content-type": "application/json" } };
    await cliFetch("http://127.0.0.1:38986/api/v1/threads", init);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:38986/api/v1/threads",
      init,
    );
  });

  it("declares the thread it runs inside", async () => {
    vi.stubEnv("PATCHER_THREAD_ID", "thr_abc123");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch("http://127.0.0.1:38986/api/v1/plugins/secrets/enable", {
      method: "POST",
    });

    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("fetch was called without an init");
    const headers = new Headers(init.headers);
    expect(headers.get(PATCHER_THREAD_ID_HEADER)).toBe("thr_abc123");
    // Nothing else about the request changes.
    expect(init.method).toBe("POST");
  });

  it("leaves a thread the caller declared alone", async () => {
    vi.stubEnv("PATCHER_THREAD_ID", "thr_ambient");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch("http://127.0.0.1:38986/api/v1/threads", {
      headers: { [PATCHER_THREAD_ID_HEADER]: "thr_explicit" },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("fetch was called without an init");
    expect(new Headers(init.headers).get(PATCHER_THREAD_ID_HEADER)).toBe(
      "thr_explicit",
    );
  });

  it("stays out of the way when the ambient thread id is malformed", async () => {
    // Failing every CLI call over a bad environment variable would be a worse
    // failure than not declaring the thread; the commands that need the id
    // report it themselves.
    vi.stubEnv("PATCHER_THREAD_ID", "not a valid id!");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch("http://127.0.0.1:38986/api/v1/threads");

    const init = fetchMock.mock.calls[0]?.[1];
    expect(
      init?.headers === undefined
        ? null
        : new Headers(init.headers).get(PATCHER_THREAD_ID_HEADER),
    ).toBeNull();
  });
});
