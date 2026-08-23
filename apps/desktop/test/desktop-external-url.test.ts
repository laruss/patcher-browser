import { describe, expect, it } from "vitest";
import {
  createExternalUrlQueue,
  EXTERNAL_URL_QUEUE_LIMIT,
  normalizeExternalUrl,
} from "../src/desktop-external-url.js";

describe("normalizeExternalUrl", () => {
  it("accepts http and https", () => {
    expect(normalizeExternalUrl("https://example.com/a?b=1")).toBe(
      "https://example.com/a?b=1",
    );
    expect(normalizeExternalUrl("http://example.com")).toBe(
      "http://example.com/",
    );
  });

  it("refuses everything the browsed view would refuse", () => {
    expect(normalizeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("patcher://open")).toBeNull();
    expect(normalizeExternalUrl("not a url")).toBeNull();
  });
});

describe("createExternalUrlQueue", () => {
  it("drains once, oldest first", () => {
    const queue = createExternalUrlQueue();

    expect(queue.push("https://example.com/one")).toBe(true);
    expect(queue.push("https://example.com/two")).toBe(true);

    expect(queue.takeAll()).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
    // The drain is what keeps a cold start from opening the same link twice:
    // the surface pulls on mount and the pending nudge pulls again.
    expect(queue.takeAll()).toEqual([]);
  });

  it("keeps repeats, because two clicks are two tabs", () => {
    const queue = createExternalUrlQueue();

    queue.push("https://example.com/");
    queue.push("https://example.com/");

    expect(queue.takeAll()).toHaveLength(2);
  });

  it("rejects a URL it will not open instead of queueing it", () => {
    const queue = createExternalUrlQueue();

    expect(queue.push("file:///tmp/page.html")).toBe(false);
    expect(queue.takeAll()).toEqual([]);
  });

  it("drops the oldest when nothing drains it", () => {
    const queue = createExternalUrlQueue();

    for (let index = 0; index < EXTERNAL_URL_QUEUE_LIMIT + 2; index += 1) {
      queue.push(`https://example.com/${index}`);
    }
    const urls = queue.takeAll();

    expect(urls).toHaveLength(EXTERNAL_URL_QUEUE_LIMIT);
    expect(urls[0]).toBe("https://example.com/2");
    expect(urls.at(-1)).toBe(
      `https://example.com/${EXTERNAL_URL_QUEUE_LIMIT + 1}`,
    );
  });
});
