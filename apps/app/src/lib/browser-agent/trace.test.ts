import { describe, expect, it } from "vitest";
import {
  BROWSER_COMMAND_MAX_TRACE_IMAGE_BASE64_LENGTH,
  BROWSER_COMMAND_MAX_TRACE_STEPS,
  type BrowserCommand,
  type BrowserCommandOutcome,
} from "@patcher/domain";
import { BrowserTraceRecorder, browserCommandChangesPage } from "./trace";

const OK: BrowserCommandOutcome = { ok: true, value: { type: "tabs", tabs: [] } };

function click(ref: string): BrowserCommand {
  return {
    type: "page.interact",
    tabId: null,
    generation: null,
    interaction: {
      action: "click",
      ref,
      button: "left",
      clickCount: 1,
      modifiers: [],
    },
  };
}

describe("browserCommandChangesPage", () => {
  it("takes a picture after anything that is not a plain read", () => {
    expect(browserCommandChangesPage(click("e1"))).toBe(true);
    expect(browserCommandChangesPage({ type: "tabs.list" })).toBe(false);
    expect(
      browserCommandChangesPage({
        type: "page.snapshot",
        tabId: null,
        maxDepth: null,
        selector: null,
      }),
    ).toBe(false);
  });
});

describe("BrowserTraceRecorder", () => {
  it("records nothing until it is started, and nothing after it stops", () => {
    const recorder = new BrowserTraceRecorder();

    recorder.record(click("e1"), OK, null, 0);
    expect(recorder.active).toBe(false);

    recorder.start(1_000, false);
    recorder.record(click("e2"), OK, null, 1_500);
    const trace = recorder.stop(2_000);
    recorder.record(click("e3"), OK, null, 2_500);

    expect(trace?.steps).toEqual([
      {
        seq: 1,
        at: 500,
        command: "page.interact",
        detail: "click e2",
        ok: true,
        error: null,
        image: null,
      },
    ]);
    expect(trace?.durationMs).toBe(1_000);
  });

  it("refuses to start a second trace over a running one", () => {
    const recorder = new BrowserTraceRecorder();

    expect(recorder.start(0, false)).toBe(true);
    expect(recorder.start(0, false)).toBe(false);
    expect(recorder.stop(0)).not.toBeNull();
    expect(recorder.stop(0)).toBeNull();
  });

  it("carries a failure's code, which is the reason to read a trace at all", () => {
    const recorder = new BrowserTraceRecorder();
    recorder.start(0, false);

    recorder.record(
      click("e9"),
      { ok: false, code: "unknown_ref", message: "No such element." },
      null,
      0,
    );

    expect(recorder.stop(0)?.steps[0]).toMatchObject({
      ok: false,
      error: "unknown_ref",
    });
  });

  it("keeps the newest steps and counts what the ring dropped", () => {
    const recorder = new BrowserTraceRecorder();
    recorder.start(0, false);

    for (let index = 0; index <= BROWSER_COMMAND_MAX_TRACE_STEPS; index += 1) {
      recorder.record(click(`e${index + 1}`), OK, null, 0);
    }

    const trace = recorder.stop(0);
    expect(trace?.steps).toHaveLength(BROWSER_COMMAND_MAX_TRACE_STEPS);
    expect(trace?.droppedSteps).toBe(1);
    // The sequence numbers do not restart, so a gap at the front is visible in
    // the file rather than only in the count.
    expect(trace?.steps[0]?.seq).toBe(2);
  });

  it("goes on recording without pictures once the images fill their budget", () => {
    const recorder = new BrowserTraceRecorder();
    recorder.start(0, true);
    const image = "x".repeat(200_000);
    const fit = Math.floor(
      BROWSER_COMMAND_MAX_TRACE_IMAGE_BASE64_LENGTH / image.length,
    );

    for (let index = 0; index <= fit; index += 1) {
      recorder.record(click("e1"), OK, image, 0);
    }

    const trace = recorder.stop(0);
    expect(trace?.steps.filter((step) => step.image !== null)).toHaveLength(fit);
    expect(trace?.droppedImages).toBe(1);
    // The step itself is still there — the log is what a trace is for.
    expect(trace?.steps).toHaveLength(fit + 1);
  });
});
