import { describe, expect, it } from "vitest";
import { createBrowserTabQueue } from "./tab-queue";

/**
 * Taking turns, per tab.
 *
 * Every case here is about a *pair* of commands, because that is the only shape
 * the bug had: one command alone was always fine, and the suite that covered
 * the executor never sent two.
 */

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("the browser tab queue", () => {
  it("holds the second command on a tab until the first has finished", async () => {
    const queue = createBrowserTabQueue();
    const first = deferred();
    const order: string[] = [];

    const a = queue.run("tab-1", async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
    });
    const b = queue.run("tab-1", async () => {
      order.push("b:start");
    });

    // The point of the whole file: b has not started while a is in the air.
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("lets two tabs work at the same time", async () => {
    const queue = createBrowserTabQueue();
    const held = deferred();
    const order: string[] = [];

    const slow = queue.run("tab-1", async () => {
      await held.promise;
      order.push("slow");
    });
    await queue.run("tab-2", async () => {
      order.push("other");
    });

    // Ownership exists so two agents can work at once; serializing the window
    // would have taken that back.
    expect(order).toEqual(["other"]);
    held.resolve();
    await slow;
  });

  it("does not serialize a command with no tab to act on", async () => {
    const queue = createBrowserTabQueue();
    const held = deferred();
    const order: string[] = [];

    const slow = queue.run("tab-1", async () => {
      await held.promise;
      order.push("slow");
    });
    await queue.run(null, async () => {
      order.push("listing");
    });

    expect(order).toEqual(["listing"]);
    held.resolve();
    await slow;
  });

  it("keeps the chain moving after a command fails", async () => {
    const queue = createBrowserTabQueue();
    const order: string[] = [];

    const failed = queue.run("tab-1", async () => {
      order.push("failed");
      throw new Error("the page went away");
    });
    const after = queue.run("tab-1", async () => {
      order.push("after");
    });

    await expect(failed).rejects.toThrow("the page went away");
    await after;
    // A poisoned chain would strand every later command on that tab, which is
    // worse than the failure that started it.
    expect(order).toEqual(["failed", "after"]);
  });

  it("hands the failure to its own caller, not to the next one", async () => {
    const queue = createBrowserTabQueue();

    const failed = queue.run("tab-1", () => Promise.reject(new Error("mine")));
    const after = queue.run("tab-1", () => Promise.resolve("theirs"));

    await expect(failed).rejects.toThrow("mine");
    await expect(after).resolves.toBe("theirs");
  });

  it("forgets a tab once nothing is queued for it", async () => {
    const queue = createBrowserTabQueue();
    await queue.run("tab-1", () => Promise.resolve());
    // Flushed, because the cleanup runs a microtask behind the command it
    // follows — and asserting before it has run would pass either way, which is
    // the shape of a test that pins nothing.
    await Promise.resolve();
    await Promise.resolve();

    // A queue that kept every tab it had ever seen would still run everything
    // in order; only this says so.
    expect(queue.size).toBe(0);
  });

  it("keeps the chain while a command is still queued behind one", async () => {
    const queue = createBrowserTabQueue();
    const held = deferred();

    const first = queue.run("tab-1", () => held.promise);
    const second = queue.run("tab-1", () => Promise.resolve());
    await Promise.resolve();

    expect(queue.size).toBe(1);
    held.resolve();
    await Promise.all([first, second]);
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.size).toBe(0);
  });
});
