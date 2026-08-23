// Backend tests for the site-tweaks example, against the official harness
// (`@patcher/plugin-sdk/testing`) — no Patcher server and no browser, but a real SQLite file
// in a temp directory and the *same refusals the install makes*, which is the
// point of running the double rather than mocking `patcher`.
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
  pluginSitesFromManifest,
  type FakePluginHost,
} from "@patcher/plugin-sdk/testing";
import siteTweaks, { repoFromUrl } from "./server";

/**
 * Both declarations read off this plugin's own package.json.
 *
 * `sites` matters as much as `permissions` here: a hand-written list in the test
 * could register a style against a site the manifest never declared, which is
 * exactly what an install refuses.
 */
async function load(): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    permissions: pluginPermissionsFromManifest(import.meta.url),
    sites: pluginSitesFromManifest(import.meta.url),
    pluginId: "site-tweaks",
  });
  await siteTweaks(host.patcher);
  return host;
}

describe("the page style", () => {
  it("is declared for the site the manifest declares, and nothing else", async () => {
    const host = await load();

    // Not a spelling check: the fake host refuses a `matches` entry that is not in
    // `patcher.sites`, so this passing is the same check the install performs.
    expect(host.harness.registrations.pageStyles).toHaveLength(1);
    expect(host.harness.registrations.pageStyles[0]?.matches).toEqual([
      "https://github.com/**",
    ]);
  });

  it("wins against the site's own stylesheet", async () => {
    const host = await load();
    const css = host.harness.registrations.pageStyles[0]?.css ?? "";

    // A rule without `!important` loses to GitHub's own, which was there first —
    // so a style that silently did nothing would look exactly like this one.
    for (const rule of css.split("}").filter((part) => part.includes("{"))) {
      expect(rule).toContain("!important");
    }
  });
});

describe("repoFromUrl", () => {
  it("reads owner/repo out of any page inside a repository", () => {
    expect(repoFromUrl("https://github.com/patcher/browser")).toBe(
      "patcher/browser",
    );
    expect(repoFromUrl("https://github.com/patcher/browser/pull/42")).toBe(
      "patcher/browser",
    );
    expect(repoFromUrl("https://github.com/patcher/browser.git")).toBe(
      "patcher/browser",
    );
  });

  it("answers null for github pages that are not a repository", () => {
    expect(repoFromUrl("https://github.com/")).toBeNull();
    expect(repoFromUrl("https://github.com/patcher")).toBeNull();
    // `/settings/keys` looks exactly like `/owner/repo` and is not one.
    expect(repoFromUrl("https://github.com/settings/keys")).toBeNull();
    expect(repoFromUrl("https://github.com/orgs/patcher/people")).toBeNull();
  });

  // The panel is scoped by the host, but `browserUrl` is still a page address
  // rather than a promise about the page, so this has to hold on its own.
  it("answers null for anything that is not github over https", () => {
    expect(repoFromUrl("https://gitlab.com/patcher/browser")).toBeNull();
    expect(repoFromUrl("http://github.com/patcher/browser")).toBeNull();
    expect(repoFromUrl("not a url")).toBeNull();
  });
});

describe("repo notes", () => {
  it("keeps notes per repository, newest first", async () => {
    const host = await load();

    await host.harness.callRpc("addNote", {
      repo: "patcher/browser",
      body: "check the overlay owner",
    });
    await host.harness.callRpc("addNote", {
      repo: "patcher/browser",
      body: "second",
    });
    await host.harness.callRpc("addNote", {
      repo: "other/repo",
      body: "elsewhere",
    });

    expect(
      (
        (await host.harness.callRpc("notes", { repo: "patcher/browser" })) as {
          notes: { body: string }[];
        }
      ).notes.map((note) => note.body),
    ).toEqual(["second", "check the overlay owner"]);
    expect(
      (
        (await host.harness.callRpc("notes", { repo: "other/repo" })) as {
          notes: { body: string }[];
        }
      ).notes.map((note) => note.body),
    ).toEqual(["elsewhere"]);
  });

  it("ignores a note that is only whitespace", async () => {
    const host = await load();

    const result = (await host.harness.callRpc("addNote", {
      repo: "patcher/browser",
      body: "   ",
    })) as { notes: unknown[] };

    expect(result.notes).toEqual([]);
  });

  // The panel only ever shows one repository, so a delete that could reach
  // another's row would be a capability the UI never offers.
  it("refuses to delete a note belonging to another repository", async () => {
    const host = await load();
    await host.harness.callRpc("addNote", {
      repo: "patcher/browser",
      body: "keep",
    });
    const { notes } = (await host.harness.callRpc("notes", {
      repo: "patcher/browser",
    })) as { notes: { id: number }[] };
    const id = notes[0]?.id ?? 0;

    await host.harness.callRpc("deleteNote", { repo: "other/repo", id });

    expect(
      (
        (await host.harness.callRpc("notes", { repo: "patcher/browser" })) as {
          notes: unknown[];
        }
      ).notes,
    ).toHaveLength(1);
  });
});

// The in-page half. Nothing here runs the script — that is the browser's job, in a
// world this test does not have — so what is checkable is the declaration and the
// backend the script talks to. The script's own behaviour is pinned where it can
// be: the desktop shell's tests.
describe("the page script", () => {
  it("is declared for the site the manifest declares, and nothing else", async () => {
    const host = await load();

    // Same check as the page style's: the fake host refuses a `matches` entry the
    // manifest does not carry, so passing here is passing the install.
    expect(host.harness.registrations.pageScripts).toHaveLength(1);
    expect(host.harness.registrations.pageScripts[0]?.matches).toEqual([
      "https://github.com/**",
    ]);
  });

  // The two mistakes that make a page script silently do nothing. Both are in the
  // shipped source, and both are easy to lose in an edit.
  it("waits for the document and survives the site's own navigations", async () => {
    const host = await load();
    const code = host.harness.registrations.pageScripts[0]?.code ?? "";

    // The code runs before the page has any elements, so DOM work has to be
    // inside `patcher.ready` — `document.body` is null at the top level.
    expect(code).toContain("patcher.ready(");
    // GitHub replaces the page's content on its own navigations and takes the
    // button with it. A page script is re-run per document, and a client-side
    // route change is not one.
    expect(code).toContain("MutationObserver");
  });

  it("notes the page the button was clicked on, and tells the panel", async () => {
    const host = await load();

    const answer = await host.harness.callRpc("notePage", {
      url: "https://github.com/patcher/browser/pull/42",
      body: "Fix the thing by Patcher · Pull Request #42",
    });

    expect(answer).toEqual({ repo: "patcher/browser" });
    expect(
      (
        (await host.harness.callRpc("notes", { repo: "patcher/browser" })) as {
          notes: { body: string }[];
        }
      ).notes.map((note) => note.body),
    ).toEqual(["Fix the thing by Patcher · Pull Request #42"]);
    // What closes the loop: the panel is listening on this channel, so the note
    // appears in the browser's own chrome as the click lands in the page.
    expect(host.harness.realtimeSignals).toEqual([
      { channel: "notes", payload: { repo: "patcher/browser" } },
    ]);
  });

  // The script runs on all of github.com, and most of github.com is not a
  // repository. Saying so is an answer, not a failure.
  it("answers null for a github page that is not a repository", async () => {
    const host = await load();

    expect(
      await host.harness.callRpc("notePage", {
        url: "https://github.com/notifications",
        body: "Notifications",
      }),
    ).toEqual({ repo: null });
    expect(host.harness.realtimeSignals).toEqual([]);
  });
});
