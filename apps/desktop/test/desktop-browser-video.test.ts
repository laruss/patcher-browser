import { describe, expect, it } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_MAX_VIDEO_BASE64_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAMES,
  PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH,
} from "@patcher/desktop-contract";
import { BrowserVideoRecording } from "../src/desktop-browser-video.js";

describe("BrowserVideoRecording", () => {
  it("keeps a frame per interval and counts the ones the pacing threw away", () => {
    // 5/s means one frame per 200ms. Chromium sends one per paint, so most of
    // what arrives is dropped by design — and a caller reading four frames from
    // a two-second recording needs the count to know that was deliberate.
    const recording = new BrowserVideoRecording(1_000, 5);

    recording.offerFrame("a", 1_000);
    recording.offerFrame("b", 1_050);
    recording.offerFrame("c", 1_100);
    recording.offerFrame("d", 1_200);

    const result = recording.finish(1_400);
    expect(result.frames).toEqual([
      { at: 0, base64: "a" },
      { at: 200, base64: "d" },
    ]);
    expect(result.droppedFrames).toBe(2);
    expect(result.durationMs).toBe(400);
  });

  it("stops keeping frames once they weigh what the bridge will carry", () => {
    const recording = new BrowserVideoRecording(0, 1);
    const frame = "x".repeat(PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH);
    const fit = Math.floor(
      PATCHER_DESKTOP_BROWSER_MAX_VIDEO_BASE64_LENGTH /
        PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH,
    );

    for (let index = 0; index <= fit; index += 1) {
      recording.offerFrame(frame, index * 1_000);
    }

    const result = recording.finish(fit * 1_000);
    expect(result.frames).toHaveLength(fit);
    expect(result.droppedFrames).toBe(1);
  });

  it("drops one frame that is larger than the per-frame cap, not the recording", () => {
    const recording = new BrowserVideoRecording(0, 1);

    recording.offerFrame(
      "x".repeat(PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH + 1),
      0,
    );
    recording.offerFrame("small", 1_000);

    const result = recording.finish(1_000);
    expect(result.frames).toEqual([{ at: 1_000, base64: "small" }]);
    expect(result.droppedFrames).toBe(1);
  });

  it("never keeps more frames than the wire's own limit", () => {
    const recording = new BrowserVideoRecording(0, 1);

    for (let index = 0; index <= PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAMES; index += 1) {
      recording.offerFrame("f", index * 1_000);
    }

    expect(recording.finish(0).frames).toHaveLength(
      PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAMES,
    );
  });

  it("stamps a chapter where it belongs in the film", () => {
    const recording = new BrowserVideoRecording(5_000, 5);

    recording.chapter("signed in", 7_500);

    expect(recording.finish(9_000).chapters).toEqual([
      { at: 2_500, title: "signed in" },
    ]);
  });

  it("never stamps a negative time when the clock goes backwards", () => {
    const recording = new BrowserVideoRecording(1_000, 5);

    recording.offerFrame("a", 900);

    expect(recording.finish(800)).toMatchObject({
      frames: [{ at: 0, base64: "a" }],
      durationMs: 0,
    });
  });
});
