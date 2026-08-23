// Backend tests for the bookmarks example, against the official harness
// (`@patcher/plugin-sdk/testing`) — no Patcher server, no browser, but a real SQLite file in
// a temp directory, so the store is exercised rather than mocked.
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
  type FakePluginHost,
} from "@patcher/plugin-sdk/testing";
import bookmarks from "./server";

const PAGE = { url: "https://example.test/docs", title: "The docs" };

async function load(): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    permissions: pluginPermissionsFromManifest(import.meta.url),
    pluginId: "bookmarks",
  });
  await bookmarks(host.patcher);
  return host;
}

function star(host: FakePluginHost) {
  const item = host.harness.registrations.toolbarItems[0];
  if (item === undefined) throw new Error("no toolbar item registered");
  return item;
}

function widget(host: FakePluginHost) {
  const one = host.harness.registrations.newTabWidgets[0];
  if (one === undefined) throw new Error("no new tab widget registered");
  return one;
}

function command(host: FakePluginHost) {
  const one = host.harness.registrations.commands[0];
  if (one === undefined) throw new Error("no command registered");
  return one;
}

function provider(host: FakePluginHost) {
  const one = host.harness.registrations.omniboxProviders[0];
  if (one === undefined) throw new Error("no omnibox provider registered");
  return one;
}

/** What the star is being asked about — a page, in a tab. */
function context(page = PAGE) {
  return { tabId: "browser:a", url: page.url, title: page.title };
}

describe("bookmarks", () => {
  it("claims the three chrome surfaces plus the omnibox", async () => {
    const host = await load();

    expect(star(host).id).toBe("star");
    expect(widget(host).id).toBe("saved");
    expect(command(host).shortcut).toEqual({ key: "d", mod: true });
    expect(provider(host).id).toBe("bookmarks");
  });

  // The whole reason the toolbar surface has a `state`: the star has to be filled
  // in before anyone touches it, on a page saved in some earlier session.
  it("fills the star in for a page it already has, and empties it on a second press", async () => {
    const host = await load();

    expect(await star(host).state?.(context())).toBeNull();

    await star(host).run(context());

    expect(await star(host).state?.(context())).toEqual({
      active: true,
      title: "Remove from bookmarks",
    });

    await star(host).run(context());

    expect(await star(host).state?.(context())).toBeNull();
  });

  // One store behind every way in, so the chord and the star cannot disagree about
  // what "saved" means.
  it("saves the page the chord fired on, and the star knows", async () => {
    const host = await load();
    host.harness.browser.setTabs([
      { tabId: "browser:a", url: PAGE.url, title: PAGE.title },
    ]);

    await command(host).run();

    expect(await star(host).state?.(context())).toMatchObject({ active: true });
  });

  // The chord fires anywhere in the app, including where there is no page — an
  // agent screen, or a desktop shell that is not running.
  it("does nothing when the chord fires with no page to read", async () => {
    const host = await load();
    host.harness.browser.setTabs([]);

    await expect(command(host).run()).resolves.toBeUndefined();
    expect(await widget(host).rows({ tabId: "browser:a" })).toBeNull();
  });

  // A row is an `http`/`https` link the browser will follow, and the host refuses
  // anything else — so the store never holds what the list could not show.
  it("refuses to save a page that is not a link", async () => {
    const host = await load();
    host.harness.browser.setTabs([
      { tabId: "browser:a", url: "file:///etc/hosts", title: "hosts" },
    ]);

    await command(host).run();

    expect(await widget(host).rows({ tabId: "browser:a" })).toBeNull();
  });

  it("lists what is saved, newest first, and falls back to the URL for a page with no title", async () => {
    const host = await load();
    await star(host).run(context());
    await star(host).run(
      context({ url: "https://example.test/blog", title: "" }),
    );

    expect(await widget(host).rows({ tabId: "browser:a" })).toEqual([
      { title: "https://example.test/blog", url: "https://example.test/blog" },
      { title: "The docs", url: "https://example.test/docs" },
    ]);
  });

  // Two pages saved in the same millisecond is ordinary — a chord, then the star —
  // and "newest first" has to mean something then too. The timestamps are flattened
  // here because the ordinary path would otherwise decide this by how fast the
  // machine is, which is how an ordering test passes for the wrong reason.
  it("still orders newest first when two pages share a timestamp", async () => {
    const host = await load();
    await star(host).run(context());
    await star(host).run(
      context({ url: "https://example.test/blog", title: "The blog" }),
    );
    host.patcher.storage
      .database()
      .prepare(`UPDATE bookmarks SET saved_at = 1000`)
      .run();

    expect(await widget(host).rows({ tabId: "browser:a" })).toEqual([
      { title: "The blog", url: "https://example.test/blog" },
      { title: "The docs", url: "https://example.test/docs" },
    ]);
  });

  // Nothing saved means no heading: a new tab looks exactly as it did before the
  // plugin was installed.
  it("shows no section at all until something is saved", async () => {
    const host = await load();

    expect(await widget(host).rows({ tabId: "browser:a" })).toBeNull();
  });

  it("finds a saved page by title or by url, as a row that just navigates", async () => {
    const host = await load();
    await star(host).run(context());

    expect(await provider(host).suggest({ query: "docs" })).toEqual([
      {
        id: PAGE.url,
        title: "The docs",
        subtitle: PAGE.url,
        score: 0.6,
        action: { type: "navigate", url: PAGE.url },
      },
    ]);
    expect(
      await provider(host).suggest({ query: "example.test" }),
    ).toHaveLength(1);
    expect(await provider(host).suggest({ query: "nothing" })).toEqual([]);
  });

  // `%` and `_` are wildcards in a LIKE pattern, so a user typing one would match
  // everything — which looks like the search is broken rather than empty.
  it("treats a wildcard in the query as a character", async () => {
    const host = await load();
    await star(host).run(context());

    expect(await provider(host).suggest({ query: "%" })).toEqual([]);
    expect(await provider(host).suggest({ query: "d_cs" })).toEqual([]);
  });
});
