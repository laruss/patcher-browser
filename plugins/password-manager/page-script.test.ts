// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeLoginForms } from "./page-script.js";

const events: unknown[] = [];
const scriptApi = {
  ready: (run: () => void) => run(),
  rpc: async (method: string, input?: unknown) => {
    events.push({ method, input });
    return { ok: true };
  },
};
const login =
  '<form><input autocomplete="username" value="alice"><input type="password" autocomplete="current-password" value="PASSWORD-SENTINEL"><button>Sign in</button></form>';
async function settle() {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(260);
}
beforeEach(() => {
  vi.useFakeTimers();
  events.length = 0;
  document.documentElement.innerHTML =
    "<head><style>* {opacity:1; visibility:visible}</style></head><body></body>";
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { x: 0, y: 0, width: 100, height: 30 },
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLInputElement.prototype, "value", "get").mockImplementation(
    () => {
      throw Error("Page observer must not read a field value");
    },
  );
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("login form observer", () => {
  it("finds a dynamic form without ever reading values and clears a replaced/disabled form", async () => {
    observeLoginForms(scriptApi);
    document.body.innerHTML = login;
    await settle();
    expect(events).toContainEqual({
      method: "hint",
      input: { origin: "https://example.test", kind: "form", present: true },
    });
    document
      .querySelector('input[type="password"]')!
      .setAttribute("disabled", "");
    await settle();
    expect(events.at(-1)).toEqual({
      method: "hint",
      input: { origin: "https://example.test", kind: "form", present: false },
    });
    document.body.innerHTML = login;
    await settle();
    expect(events.at(-1)).toEqual({
      method: "hint",
      input: { origin: "https://example.test", kind: "form", present: true },
    });
    expect(JSON.stringify(events)).not.toContain("PASSWORD-SENTINEL");
  });
  it("treats ambiguous, hidden, readonly, disabled-fieldset and cross-origin forms as absent", async () => {
    observeLoginForms(scriptApi);
    for (const html of [
      login.replace(
        '<input type="password"',
        '<input type="password" readonly',
      ),
      login.replace(
        '<input type="password"',
        '<input type="password" style="opacity:0"',
      ),
      login.replace("<form>", '<form action="https://evil.test/login">'),
      login.replace("current-password", "new-password"),
      login.replace("</form>", '<input type="password"></form>'),
      `<fieldset disabled>${login}</fieldset>`,
    ]) {
      document.body.innerHTML = html;
      await settle();
      expect(events.at(-1)).toEqual({
        method: "hint",
        input: { origin: "https://example.test", kind: "form", present: false },
      });
    }
    expect(
      events.some(
        (event) => (event as { input: { present: boolean } }).input.present,
      ),
    ).toBe(false);
  });
  it("reports native submit as advisory, ignores a forged submit, and removes listeners on navigation", async () => {
    document.body.innerHTML = login;
    observeLoginForms(scriptApi);
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => event.preventDefault());
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(events).toHaveLength(1);
    form.requestSubmit();
    expect(events.at(-1)).toEqual({
      method: "hint",
      input: { origin: "https://example.test", kind: "submit", present: true },
    });
    const count = events.length;
    window.dispatchEvent(new Event("pagehide"));
    document.body.innerHTML = login;
    await settle();
    expect(events).toHaveLength(count);
    expect(JSON.stringify(events)).not.toContain("PASSWORD-SENTINEL");
  });
});
