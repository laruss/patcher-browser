// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import {
  browserTabHandoverAskAtom,
  browserTabOwnersAtom,
} from "@/lib/browser-agent/tab-owners";
import {
  browserSurfaceTabsAtom,
  createBrowserSurfaceTab,
} from "@/lib/browser-surface-tabs";
import { BrowserTabHandover } from "./BrowserTabHandover";

/**
 * The person's side of handing a tab to an agent.
 *
 * The agent's side is a refusal it can do nothing about, so what is on screen
 * here is the whole of the answer: the wrong name, or a button that claims the
 * wrong tab, and the person gives a page away to something they were not
 * talking to.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_1",
  label: "Claude Code",
  level: "interact",
};

afterEach(cleanup);

function renderHandover({
  ask,
}: {
  ask: { issuer: BrowserCommandIssuer; tabId: string } | null;
}) {
  const store = createStore();
  const first = {
    ...createBrowserSurfaceTab("https://person.example/"),
    id: "a",
    title: "The person's page",
  };
  const second = {
    ...createBrowserSurfaceTab("https://other.example/"),
    id: "b",
    title: "Another page",
  };
  store.set(browserSurfaceTabsAtom, {
    activeTabId: "a",
    tabs: [first, second],
  });
  if (ask !== null) store.set(browserTabHandoverAskAtom, ask);
  render(<BrowserTabHandover />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    ),
  });
  return { store };
}

describe("the tab handover ask", () => {
  it("shows nothing while nobody has asked", () => {
    renderHandover({ ask: null });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the agent that asked and the tab it asked for", () => {
    renderHandover({ ask: { issuer: GRANT, tabId: "b" } });

    const row = screen.getByRole("status");
    // The tab it asked for, not the one in front of the person: an agent can be
    // refused a tab that is not the active one, and handing over the wrong page
    // is worse than handing over none.
    expect(row.textContent).toContain("Claude Code");
    expect(row.textContent).toContain("Another page");
  });

  it("hands over the tab that was asked for, not the one in front of the person", () => {
    // "a" is active; the agent was refused "b". Claiming the active tab would
    // pass a test written on the active one and give away the wrong page here.
    const { store } = renderHandover({ ask: { issuer: GRANT, tabId: "b" } });

    screen.getByRole("button", { name: "Hand it over" }).click();

    expect(store.get(browserTabOwnersAtom).get("b")).toEqual(GRANT);
    expect(store.get(browserTabOwnersAtom).has("a")).toBe(false);
    // And the question goes: leaving it up would offer to give away a tab that
    // is already given.
    expect(store.get(browserTabHandoverAskAtom)).toBeNull();
  });

  it("gives nothing away when the answer is no", () => {
    const { store } = renderHandover({ ask: { issuer: GRANT, tabId: "a" } });

    screen.getByRole("button", { name: "Not now" }).click();

    expect(store.get(browserTabOwnersAtom).size).toBe(0);
    expect(store.get(browserTabHandoverAskAtom)).toBeNull();
  });

  it("says nothing about a tab that has since been closed", () => {
    renderHandover({ ask: { issuer: GRANT, tabId: "closed-tab" } });

    expect(screen.queryByRole("status")).toBeNull();
  });
});
