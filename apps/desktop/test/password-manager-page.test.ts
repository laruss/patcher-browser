// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPasswordManagerPage } from "../src/password-manager-page.js";
import type {
  PasswordPageApi,
  PageAccount,
} from "../src/password-manager-page-ipc.js";

let pickerRoot: ShadowRoot | undefined;
let page: ReturnType<typeof installPasswordManagerPage> | undefined;
const alice = { id: "alice", version: 1, username: "alice@example.com" };
const bob = { id: "bob", version: 1, username: "bob@example.com" };
beforeEach(() => {
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    options,
  ) {
    const root = attach.call(this, options);
    pickerRoot = root;
    return root;
  });
  vi.spyOn(HTMLInputElement.prototype, "getClientRects").mockImplementation(
    () => [{ width: 100, height: 24 }] as unknown as DOMRectList,
  );
});
afterEach(() => {
  page?.dispose();
  page = undefined;
  pickerRoot = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
function start(
  accounts: PageAccount[] = [alice],
  markup = '<form><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button>Sign in</button></form>',
) {
  document.body.innerHTML = markup;
  const api = {
    accounts: vi.fn(async () => accounts),
    fill: vi.fn(async (account: PageAccount) => ({
      username: account.username,
      password: `${account.id}-secret`,
    })),
    capture: vi.fn(),
    username: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
  } satisfies PasswordPageApi;
  page = installPasswordManagerPage(api);
  return api;
}
const password = () =>
  document.querySelector<HTMLInputElement>('input[type="password"]')!;
describe("Chrome-style form behavior", () => {
  it("autofills a single login and notifies controlled forms without submitting", async () => {
    const api = start();
    const changed = vi.fn();
    password().addEventListener("input", changed);
    await vi.waitFor(() => expect(password().value).toBe("alice-secret"));
    expect(
      document.querySelector<HTMLInputElement>('[name="username"]')!.value,
    ).toBe(alice.username);
    expect(changed).toHaveBeenCalled();
    expect(api.capture).not.toHaveBeenCalled();
  });
  it("allows clearing or replacing fields, including a later DOM rerender", async () => {
    const api = start();
    await vi.waitFor(() => expect(password().value).toBe("alice-secret"));
    password().value = "";
    password().dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("form")!.innerHTML =
      '<input autocomplete="username"><input type="password">';
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(password().value).toBe("");
    expect(api.fill).toHaveBeenCalledTimes(1);
  });
  it("offers account selection when several logins exist and fills the chosen account", async () => {
    const api = start([alice, bob]);
    await vi.waitFor(() => expect(api.accounts).toHaveBeenCalled());
    expect(password().value).toBe("");
    document.querySelector<HTMLInputElement>('[name="username"]')!.focus();
    await vi.waitFor(() =>
      expect(pickerRoot?.querySelectorAll("button").length).toBe(2),
    );
    pickerRoot!.querySelectorAll("button")[1]!.click();
    await vi.waitFor(() => expect(password().value).toBe("bob-secret"));
    expect(api.fill).toHaveBeenCalledWith(
      bob,
      expect.stringMatching(/^[a-f0-9]{32}$/u),
    );
  });
  it("captures submission before navigation and recognizes SPA form removal", async () => {
    const api = start([]);
    await vi.waitFor(() => expect(api.accounts).toHaveBeenCalled());
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => event.preventDefault());
    document.querySelector<HTMLInputElement>('[name="username"]')!.value =
      "new-user";
    password().value = "new-secret";
    form.requestSubmit();
    expect(api.capture).toHaveBeenCalledWith({
      username: "new-user",
      password: "new-secret",
      submitted: true,
    });
    expect(api.success).not.toHaveBeenCalled();
    form.remove();
    await vi.waitFor(() => expect(api.success).toHaveBeenCalledTimes(1));
  });
  it("does not overwrite signup/new-password fields and captures the new password on change forms", async () => {
    const api = start(
      [alice],
      '<form><input autocomplete="username" value="alice@example.com"><input type="password" autocomplete="current-password"><input type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"><button>Save</button></form>',
    );
    await vi.waitFor(() => expect(password().value).toBe("alice-secret"));
    const fresh = [
      ...document.querySelectorAll<HTMLInputElement>(
        '[autocomplete="new-password"]',
      ),
    ];
    expect(fresh.map((input) => input.value)).toEqual(["", ""]);
    fresh.forEach((input) => {
      input.value = "replacement";
    });
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => event.preventDefault());
    form.requestSubmit();
    expect(api.capture).toHaveBeenCalledWith({
      username: alice.username,
      password: "replacement",
      submitted: true,
    });
  });
  it("handles username-first login steps and dynamically added password fields", async () => {
    const api = start(
      [alice],
      '<form><input autocomplete="username"><button>Continue</button></form>',
    );
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
        alice.username,
      ),
    );
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => event.preventDefault());
    form.requestSubmit();
    expect(api.username).toHaveBeenCalledWith(alice.username);
    form.innerHTML = '<input type="password"><button>Sign in</button>';
    await vi.waitFor(() => expect(password().value).toBe("alice-secret"));
    form.requestSubmit();
    expect(api.capture).toHaveBeenLastCalledWith({
      username: alice.username,
      password: "alice-secret",
      submitted: true,
    });
  });
  it("keeps the chosen account across email-first steps and records it for a password-only change", async () => {
    const api = start(
      [alice, bob],
      '<form><input type="email" name="email"><button>Next</button></form>',
    );
    await vi.waitFor(() => expect(api.accounts).toHaveBeenCalled());
    document.querySelector<HTMLInputElement>("input")!.focus();
    await vi.waitFor(() =>
      expect(pickerRoot?.querySelectorAll("button").length).toBe(2),
    );
    pickerRoot!.querySelectorAll("button")[1]!.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
        bob.username,
      ),
    );
    const form = document.querySelector("form")!;
    form.innerHTML =
      '<input type="password" autocomplete="current-password"><input type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"><button>Save</button>';
    await vi.waitFor(() => expect(password().value).toBe("bob-secret"));
    form
      .querySelectorAll<HTMLInputElement>('[autocomplete="new-password"]')
      .forEach((input) => {
        input.value = "changed-bob";
      });
    form.addEventListener("submit", (event) => event.preventDefault());
    form.requestSubmit();
    expect(api.capture).toHaveBeenLastCalledWith({
      username: bob.username,
      password: "changed-bob",
      submitted: true,
    });
  });
  it("revalidates type, autocomplete and form association after awaiting a password", async () => {
    let resolve!: (value: { username: string; password: string }) => void;
    const api = start();
    api.fill.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.waitFor(() => expect(api.fill).toHaveBeenCalled());
    password().autocomplete = "new-password";
    resolve({ username: alice.username, password: "must-not-fill" });
    await new Promise((done) => setTimeout(done, 20));
    expect(password().value).toBe("");
  });
  it("does not propose saving when an unsuccessful SPA login renders replacement or disabled fields", async () => {
    const api = start([]);
    await vi.waitFor(() => expect(api.accounts).toHaveBeenCalled());
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      form.innerHTML =
        '<p>Incorrect password</p><input name="username"><input type="password" disabled>';
    });
    password().value = "rejected-password";
    form.requestSubmit();
    await new Promise((done) => setTimeout(done, 350));
    expect(api.capture).toHaveBeenCalled();
    expect(api.success).not.toHaveBeenCalled();
  });
  it("captures a recognized password after the website reveals it", async () => {
    const api = start([]);
    await vi.waitFor(() => expect(api.accounts).toHaveBeenCalled());
    const field = password();
    field.type = "text";
    field.value = "shown-password";
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => event.preventDefault());
    form.requestSubmit();
    expect(api.capture).toHaveBeenCalledWith({
      username: "",
      password: "shown-password",
      submitted: true,
    });
  });
  it("discards the submitted password when a failed SPA login returns a ready retry form", async () => {
    const api = start([]);
    await vi.waitFor(() => expect(api.accounts).toHaveBeenCalled());
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      form.innerHTML =
        '<p>Wrong password</p><input autocomplete="username"><input type="password">';
    });
    password().value = "bad-password";
    form.requestSubmit();
    await vi.waitFor(() => expect(api.failure).toHaveBeenCalledTimes(1));
    expect(api.success).not.toHaveBeenCalled();
  });
  it("honors the most recent account selection while an earlier fill is pending", async () => {
    const api = start([alice, bob]);
    const pending = new Map<
      string,
      (value: { username: string; password: string }) => void
    >();
    api.fill.mockImplementation(
      (account) => new Promise((resolve) => pending.set(account.id, resolve)),
    );
    await vi.waitFor(() => expect(api.accounts).toHaveBeenCalled());
    const user = document.querySelector<HTMLInputElement>("[name=username]")!;
    user.focus();
    pickerRoot!.querySelectorAll("button")[0]!.click();
    user.blur();
    user.focus();
    pickerRoot!.querySelectorAll("button")[1]!.click();
    expect(api.fill).toHaveBeenCalledTimes(2);
    pending.get(bob.id)!({ username: bob.username, password: "bob-chosen" });
    await vi.waitFor(() => expect(password().value).toBe("bob-chosen"));
    pending.get(alice.id)!({
      username: alice.username,
      password: "alice-stale",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(password().value).toBe("bob-chosen");
  });
  it("does not keep password identity when a SPA reuses the control as a username", async () => {
    const api = start();
    await vi.waitFor(() => expect(password().value).toBe("alice-secret"));
    const field = password();
    document.querySelector("form")!.replaceChildren(field);
    field.type = "text";
    field.name = "username";
    field.autocomplete = "username";
    field.value = "";
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(field.value).not.toBe("alice-secret");
    expect(api.fill).toHaveBeenCalledTimes(1);
  });
});
