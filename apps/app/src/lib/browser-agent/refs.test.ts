import { describe, expect, it } from "vitest";
import { createHarness, liveState, tab } from "@/test/browser-command-harness";
import { executeBrowserCommand } from "./execute";
import {
  annotateSnapshotRefs,
  browserInteractionRefs,
  browserRefGeneration,
  splitBrowserRef,
  withBareBrowserRefs,
} from "./refs";

/**
 * A ref that carries the snapshot it came from.
 *
 * The rule these hold up: what a caller copies out of a snapshot is checked,
 * what it types by hand still works, and nothing with an `@` in it reaches the
 * shell — whose wire is frozen and would refuse it.
 */

describe("splitting a ref", () => {
  it("takes the snapshot off a ref that carries one", () => {
    expect(splitBrowserRef("e12@6")).toEqual({ ref: "e12", generation: 6 });
  });

  it("leaves a bare ref alone, and unchecked", () => {
    expect(splitBrowserRef("e12")).toEqual({ ref: "e12", generation: null });
  });

  it("does not invent a generation from something that is not one", () => {
    // Whatever this is, it is not a ref this browser minted — so it goes to the
    // shell as it came, and is refused there by name rather than silently
    // becoming `e12`.
    expect(splitBrowserRef("e12@")).toEqual({ ref: "e12@", generation: null });
    expect(splitBrowserRef("e12@x")).toEqual({
      ref: "e12@x",
      generation: null,
    });
  });
});

describe("which snapshot a command's refs belong to", () => {
  it("takes it from the refs, so nothing has to be passed", () => {
    expect(
      browserRefGeneration({ declared: null, refs: ["e2@6", "e5@6"] }),
    ).toEqual({ ok: true, generation: 6 });
  });

  it("stays unchecked for bare refs, exactly as before", () => {
    expect(browserRefGeneration({ declared: null, refs: ["e2"] })).toEqual({
      ok: true,
      generation: null,
    });
  });

  it("still honours a generation passed the old way", () => {
    expect(browserRefGeneration({ declared: 4, refs: ["e2"] })).toEqual({
      ok: true,
      generation: 4,
    });
  });

  it("refuses two refs from different snapshots", () => {
    // Holding two ideas of one page at once. Picking either would act on an
    // element the caller did not mean, and it cannot see which.
    const answer = browserRefGeneration({
      declared: null,
      refs: ["e2@6", "e5@7"],
    });

    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error("two snapshots were treated as one");
    expect(answer.message).toContain("different snapshots");
  });

  it("refuses a ref and a generation that disagree", () => {
    const answer = browserRefGeneration({ declared: 4, refs: ["e2@6"] });

    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error("the disagreement was resolved silently");
    expect(answer.message).toContain("Pass one or the other");
  });
});

describe("what reaches the shell", () => {
  it("takes the snapshot off both refs of a drag", () => {
    const bare = withBareBrowserRefs({
      action: "drag",
      ref: "e2@6",
      targetRef: "e5@6",
    });

    expect(bare).toEqual({ action: "drag", ref: "e2", targetRef: "e5" });
  });

  it("leaves an interaction with no ref alone", () => {
    const resize = { action: "resize", width: 800, height: 600 } as const;

    expect(withBareBrowserRefs(resize)).toEqual(resize);
    expect(browserInteractionRefs(resize)).toEqual([]);
  });

  it("keeps a null ref null", () => {
    // `press` without a ref types into whatever has focus, and inventing one
    // would send the key somewhere else.
    const press = { action: "press", ref: null, key: "Enter" } as const;

    expect(withBareBrowserRefs(press)).toEqual(press);
    expect(browserInteractionRefs(press)).toEqual([null]);
  });
});

describe("annotating a snapshot", () => {
  it("marks every ref with the snapshot it came from", () => {
    const snapshot = [
      '- button "Sign in" [ref=e1]',
      '  - textbox "Email" [ref=e2] [focused]',
    ].join("\n");

    expect(annotateSnapshotRefs(snapshot, 6)).toBe(
      [
        '- button "Sign in" [ref=e1@6]',
        '  - textbox "Email" [ref=e2@6] [focused]',
      ].join("\n"),
    );
  });

  it("leaves the page's own text alone", () => {
    // The whole marker is matched, so a page that talks about refs — a docs
    // site, this repository's own snapshot examples — is not rewritten.
    const snapshot = '- text "see [ref=e1] in the docs, or e2"';

    expect(annotateSnapshotRefs(snapshot, 6)).toBe(
      '- text "see [ref=e1@6] in the docs, or e2"',
    );
  });
});

/**
 * And the same thing through the executor, because the value of this is that a
 * caller gets the check without doing anything — which is a claim about what
 * the snapshot hands out and what the shell is then told, not about a parser.
 */
describe("a snapshot and the command that follows it", () => {
  const snapshotResult = {
    ok: true as const,
    tabId: "t",
    url: "https://example.com/",
    title: "Example",
    snapshot: '- button "Sign in" [ref=e1]\n- textbox "Email" [ref=e2]',
    generation: 6,
    refCount: 2,
    truncated: false,
  };

  it("hands out refs that carry the snapshot they came from", async () => {
    const harness = createHarness({
      state: { activeTabId: "t", tabs: [tab("t")] },
      live: { t: liveState("t") },
      snapshot: snapshotResult,
    });

    const outcome = await executeBrowserCommand(
      { type: "page.snapshot", tabId: null, maxDepth: null, selector: null },
      harness.deps,
    );

    if (!outcome.ok || outcome.value.type !== "snapshot") {
      throw new Error("the snapshot failed");
    }
    expect(outcome.value.snapshot).toContain("[ref=e1@6]");
    // The generation is still its own field: a caller that reads it there, and
    // passes it the old way, is not being asked to change.
    expect(outcome.value.generation).toBe(6);
  });

  it("checks the snapshot a ref came from without being asked to", async () => {
    const harness = createHarness({
      state: { activeTabId: "t", tabs: [tab("t")] },
      live: { t: liveState("t") },
    });

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: { action: "hover", ref: "e2@6" },
      },
      harness.deps,
    );

    // The shell is told the generation — which is what makes a stale ref a
    // refusal instead of a click on whatever holds that node now — and it is
    // told a ref its own frozen wire accepts.
    expect(harness.calls.interactions).toEqual([
      {
        tabId: "t",
        generation: 6,
        interaction: { action: "hover", ref: "e2" },
      },
    ]);
  });

  it("refuses a ref and a generation that contradict each other", async () => {
    const harness = createHarness({
      state: { activeTabId: "t", tabs: [tab("t")] },
      live: { t: liveState("t") },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: 4,
        interaction: { action: "hover", ref: "e2@6" },
      },
      harness.deps,
    );

    expect(outcome).toMatchObject({ ok: false, code: "invalid_command" });
    // And nothing was done: a caller holding two ideas of the page gets neither.
    expect(harness.calls.interactions).toEqual([]);
  });

  it("carries a scoped evaluation's ref the same way", async () => {
    const harness = createHarness({
      state: { activeTabId: "t", tabs: [tab("t")] },
      live: { t: liveState("t") },
      control: {
        ok: true,
        kind: "evaluated",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        value: '"3"',
        truncated: false,
      },
    });

    await executeBrowserCommand(
      {
        type: "page.control",
        tabId: null,
        generation: null,
        operation: {
          kind: "evaluate",
          expression: "(el) => el.children.length",
          ref: "e3@6",
        },
      },
      harness.deps,
    );

    expect(harness.calls.control).toEqual([
      {
        tabId: "t",
        generation: 6,
        operation: {
          kind: "evaluate",
          expression: "(el) => el.children.length",
          ref: "e3",
        },
      },
    ]);
  });
});
