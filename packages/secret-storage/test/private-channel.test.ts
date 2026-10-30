import { Duplex, PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import {
  PrivateSecretChannel,
  SECRET_CHANNEL_HELLO_TIMEOUT_MS,
} from "../src/private-channel.js";

const channels: PrivateSecretChannel[] = [];
afterEach(() => {
  channels.splice(0).forEach((channel) => channel.close());
  vi.useRealTimers();
});
function pair() {
  const left = new PassThrough(),
    right = new PassThrough();
  const streams = [
    Duplex.from({ readable: left, writable: right }),
    Duplex.from({ readable: right, writable: left }),
  ];
  streams.forEach((stream) => stream.on("error", () => {}));
  return streams;
}
it("accepts an owned peer that greets after slow packaged/Keychain startup", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const [desktop, child] = pair();
  const channel = new PrivateSecretChannel(desktop!);
  channels.push(channel);
  await vi.advanceTimersByTimeAsync(6500);
  const peer = new PrivateSecretChannel(child!, {
    request: async () => ({ ready: true }),
  });
  channels.push(peer);
  await expect(channel.request("status")).resolves.toEqual({ ready: true });
});
it("still closes a peer that never completes the bounded handshake", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const [desktop] = pair();
  const closed = vi.fn();
  const channel = new PrivateSecretChannel(desktop!, { close: closed });
  channels.push(channel);
  await vi.advanceTimersByTimeAsync(SECRET_CHANNEL_HELLO_TIMEOUT_MS - 1);
  expect(closed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(closed).toHaveBeenCalledOnce();
  await expect(channel.request("status")).rejects.toMatchObject({
    code: "unavailable",
  });
});
