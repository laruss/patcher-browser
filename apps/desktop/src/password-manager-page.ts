import { createPasswordAccountPicker } from "./password-manager-account-picker.js";
import type {
  PageAccount,
  PasswordPageApi,
} from "./password-manager-page-ipc.js";

/** Runs in the sandboxed core preload, with no bridge in the website or plugin
 * worlds. Passwords never cross a plugin RPC or enter its observation stream. */
export function installPasswordManagerPage(api: PasswordPageApi) {
  const picker = createPasswordAccountPicker();
  const ownEvents = new WeakSet<Event>();
  const touched = new WeakSet<HTMLInputElement>();
  const filled = new WeakSet<HTMLInputElement>();
  const filling = new WeakSet<HTMLInputElement>();
  const fillRevisions = new WeakMap<HTMLInputElement, number>();
  const knownPasswords = new WeakSet<HTMLInputElement>();
  const passwordRoles = new WeakMap<
    HTMLInputElement,
    { name: string; id: string; form: HTMLFormElement | null }
  >();
  const observed = new WeakSet<HTMLInputElement>();
  const targets = new WeakMap<HTMLInputElement, HTMLInputElement | null>();
  let accounts: PageAccount[] = [],
    refreshing = false,
    disposed = false,
    passwordEdited = false,
    usernameEdited = false;
  let chosenAccount: PageAccount | null = null;
  let successTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: {
    password: HTMLInputElement;
    form: HTMLFormElement | null;
  } | null = null;
  let usernameHint = "";
  function displayed(input: HTMLInputElement) {
    if (input.type === "hidden" || !input.getClientRects().length) return false;
    for (
      let node: HTMLElement | null = input;
      node;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        node.inert ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        (style.opacity !== "" && Number(style.opacity) === 0)
      )
        return false;
    }
    return true;
  }
  function visible(input: HTMLInputElement) {
    return displayed(input) && !input.disabled && !input.readOnly;
  }
  function passwords(root: ParentNode = document, enabled = true) {
    return [...root.querySelectorAll<HTMLInputElement>("input")].filter(
      (input) => {
        const tokens = input.autocomplete.toLowerCase().split(/\s/u);
        if (
          tokens.some((token) =>
            ["one-time-code", "username", "email"].includes(token),
          )
        ) {
          knownPasswords.delete(input);
          return false;
        }
        const role = passwordRoles.get(input);
        const explicitPassword =
          tokens.includes("current-password") ||
          tokens.includes("new-password");
        if (
          knownPasswords.has(input) &&
          input.type !== "password" &&
          !explicitPassword &&
          role &&
          (input.name !== role.name ||
            input.id !== role.id ||
            input.form !== role.form)
        )
          knownPasswords.delete(input);
        if (
          input.type === "password" ||
          tokens.includes("current-password") ||
          tokens.includes("new-password")
        ) {
          knownPasswords.add(input);
          passwordRoles.set(input, {
            name: input.name,
            id: input.id,
            form: input.form,
          });
        }
        return (
          knownPasswords.has(input) &&
          ["password", "text"].includes(input.type) &&
          (enabled ? visible(input) : displayed(input))
        );
      },
    );
  }
  function hasPasswordForm() {
    return passwords(document, false).length > 0;
  }
  function username(password: HTMLInputElement) {
    const root = password.form ?? document;
    const explicit = root.querySelector<HTMLInputElement>(
      'input[autocomplete~="username"], input[autocomplete~="email"]',
    );
    if (explicit && explicit !== password && !explicit.disabled)
      return explicit;
    const inputs = [
      ...root.querySelectorAll<HTMLInputElement>(
        'input:not([type]), input[type="text"], input[type="email"], input[type="tel"]',
      ),
    ].filter((input) => visible(input) && !knownPasswords.has(input));
    return (
      inputs.find((input) =>
        /user|email|login|identifier/iu.test(`${input.name} ${input.id}`),
      ) ??
      inputs
        .filter(
          (input) =>
            (input.compareDocumentPosition(password) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
        )
        .at(-1) ??
      null
    );
  }
  function passwordFor(form: HTMLFormElement | null) {
    const inputs = passwords(form ?? document);
    const fresh = inputs.filter((input) =>
      input.autocomplete.split(/\s/u).includes("new-password"),
    );
    if (fresh.length) return fresh[0]!;
    if (inputs.length === 1) return inputs[0]!;
    if (
      inputs.length === 2 &&
      inputs[0]!.value &&
      inputs[0]!.value === inputs[1]!.value
    )
      return inputs[0]!;
    return null;
  }
  function assign(input: HTMLInputElement, value: string) {
    // Isolated-world prototypes bypass page-defined setters, while the normal
    // input/change events keep React and other controlled forms in sync.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    filled.add(input);
  }
  function notify(input: HTMLInputElement) {
    for (const kind of ["input", "change"]) {
      const event = new Event(kind, { bubbles: true });
      ownEvents.add(event);
      input.dispatchEvent(event);
    }
  }
  function fillable(password: HTMLInputElement) {
    const tokens = password.autocomplete.toLowerCase().split(/\s/u);
    if (
      tokens.some((token) =>
        ["username", "email", "one-time-code"].includes(token),
      )
    )
      return false;
    return (
      password.isConnected &&
      ["password", "text"].includes(password.type) &&
      knownPasswords.has(password) &&
      visible(password) &&
      !tokens.includes("new-password") &&
      (passwords(password.form ?? document).length === 1 ||
        tokens.includes("current-password"))
    );
  }
  function remember(account: PageAccount) {
    chosenAccount = account;
    usernameHint = account.username;
    api.username(account.username);
  }
  async function fill(
    password: HTMLInputElement,
    account: PageAccount,
    explicit = false,
  ) {
    const user = username(password),
      form = password.form,
      type = password.type;
    const stable = () =>
      fillable(password) &&
      password.type === type &&
      password.form === form &&
      username(password) === user;
    if (!stable()) return;
    const userChanged = () =>
      !!user &&
      (user.value ? user.value !== account.username : touched.has(user));
    if (
      !explicit &&
      (passwordEdited ||
        touched.has(password) ||
        password.value ||
        userChanged() ||
        (!user && usernameHint && usernameHint !== account.username))
    )
      return;
    const beforePassword = password.value,
      beforeUsername = user?.value;
    if (filling.has(password) && !explicit) return;
    const revision = (fillRevisions.get(password) ?? 0) + 1;
    fillRevisions.set(password, revision);
    filling.add(password);
    const token = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    password.setAttribute("data-patcher-password-field", token);
    let intact = false;
    let value: Awaited<ReturnType<PasswordPageApi["fill"]>>;
    try {
      value = await api.fill(account, token);
      intact = password.getAttribute("data-patcher-password-field") === token;
    } finally {
      if (fillRevisions.get(password) === revision) filling.delete(password);
      if (password.getAttribute("data-patcher-password-field") === token)
        password.removeAttribute("data-patcher-password-field");
    }
    if (
      !value ||
      !intact ||
      fillRevisions.get(password) !== revision ||
      disposed ||
      !stable() ||
      password.value !== beforePassword ||
      user?.value !== beforeUsername
    )
      return;
    if (!explicit && (passwordEdited || touched.has(password) || userChanged()))
      return;
    if (user && visible(user)) {
      assign(user, value.username);
      notify(user);
    }
    // Username handlers can rerender or repurpose the password control.
    if (!stable()) return;
    assign(password, value.password);
    remember(account);
    notify(password);
  }
  function selectAccount(input: HTMLInputElement, account: PageAccount) {
    if (disposed || !input.isConnected) return;
    const target = targets.get(input);
    if (target?.isConnected) {
      void fill(target, account, true);
      return;
    }
    assign(input, account.username);
    remember(account);
    notify(input);
  }
  function suggestions(input: HTMLInputElement) {
    const target = targets.get(input);
    const query =
      target === input || filled.has(input)
        ? ""
        : input.value.toLocaleLowerCase();
    const matches = accounts.filter((account) =>
      account.username.toLocaleLowerCase().includes(query),
    );
    picker.show(input, matches, (account) => selectAccount(input, account));
  }
  function watch(input: HTMLInputElement, password: HTMLInputElement | null) {
    targets.set(input, password);
    if (observed.has(input)) return;
    observed.add(input);
    input.addEventListener("input", (event) => {
      if (ownEvents.has(event)) return;
      touched.add(input);
      filled.delete(input);
      if (targets.get(input) === input) {
        passwordEdited = true;
        picker.hide();
      } else {
        usernameEdited = true;
        usernameHint = input.value.slice(0, 1024);
        chosenAccount = event.isTrusted
          ? (accounts.find((account) => account.username === usernameHint) ??
            null)
          : null;
        if (event.isTrusted) api.username(usernameHint);
        const target = targets.get(input);
        if (chosenAccount && target?.isConnected && !target.value) {
          picker.hide();
          void fill(target, chosenAccount);
        } else suggestions(input);
      }
    });
    input.addEventListener("pointerdown", (event) => {
      if (event.isTrusted && document.activeElement === input)
        suggestions(input);
    });
    input.addEventListener("focus", (event) => {
      const password = targets.get(input);
      if (
        !event.isTrusted ||
        disposed ||
        !accounts.length ||
        (password === input && accounts.length === 1 && !touched.has(input))
      )
        return;
      suggestions(input);
    });
  }
  function attach(password: HTMLInputElement) {
    const user = username(password);
    if (user) watch(user, password);
    watch(password, password);
    const selected =
      accounts.find((account) => account.id === chosenAccount?.id) ??
      accounts.find((account) => account.preferred) ??
      (accounts.length === 1 ? accounts[0] : undefined);
    if (selected && !passwordEdited && !password.value)
      void fill(password, selected);
  }
  function scan() {
    if (disposed) return;
    picker.update();
    if (
      pending &&
      (!pending.password.isConnected || !displayed(pending.password))
    ) {
      if (!successTimer && (!hasPasswordForm() || passwords().length))
        successTimer = setTimeout(() => {
          successTimer = undefined;
          if (
            !disposed &&
            pending &&
            (!pending.password.isConnected || !displayed(pending.password))
          ) {
            if (passwords().length) {
              pending = null;
              api.failure();
            } else if (!hasPasswordForm()) {
              pending = null;
              api.success();
            }
          }
        }, 250);
    } else if (successTimer) {
      clearTimeout(successTimer);
      successTimer = undefined;
    }
    const inputs = passwords();
    for (const input of inputs) attach(input);
    if (!inputs.length) {
      const first = [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[autocomplete~="username"],input[type="email"],input[name="username"],input[name="login"]',
        ),
      ].find(visible);
      if (first) {
        watch(first, null);
        if (
          accounts.length === 1 &&
          !usernameEdited &&
          !first.value &&
          !filled.has(first)
        ) {
          assign(first, accounts[0]!.username);
          remember(accounts[0]!);
          notify(first);
        }
      }
    }
  }
  async function refresh() {
    if (refreshing || disposed) return;
    refreshing = true;
    try {
      const next = await api.accounts(hasPasswordForm());
      if (
        JSON.stringify(
          next.map(({ id, version, username }) => ({ id, version, username })),
        ) !==
        JSON.stringify(
          accounts.map(({ id, version, username }) => ({
            id,
            version,
            username,
          })),
        )
      )
        picker.hide();
      accounts = next;
      scan();
      const input = document.activeElement;
      if (
        input instanceof HTMLInputElement &&
        targets.has(input) &&
        accounts.length &&
        (targets.get(input) !== input ||
          accounts.length > 1 ||
          touched.has(input))
      )
        suggestions(input);
    } finally {
      refreshing = false;
    }
  }
  function capture(form: HTMLFormElement | null, submitted: boolean) {
    const password = passwordFor(form);
    if (!password || !password.value || password.value.length > 4096) {
      const input = form?.querySelector<HTMLInputElement>(
        'input[autocomplete~="username"],input[type="email"],input[name*="user" i],input[name*="email" i]',
      );
      if (submitted && input?.value) {
        usernameHint = input.value.slice(0, 1024);
        api.username(usernameHint);
      }
      return;
    }
    const user = username(password)?.value ?? usernameHint;
    api.capture({
      username: user.slice(0, 1024),
      password: password.value,
      submitted,
    });
    if (successTimer) {
      clearTimeout(successTimer);
      successTimer = undefined;
    }
    pending = { password, form };
    setTimeout(scan, 250);
  }
  const submit = (event: Event) => {
    if (event.isTrusted && event.target instanceof HTMLFormElement)
      capture(event.target, true);
  };
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (pending && event.target.closest("a[href]")) {
      pending = null;
      api.failure();
    }
    const control = event.target.closest<HTMLButtonElement | HTMLInputElement>(
      'button,input[type="submit"],input[type="image"],[role="button"]',
    );
    if (
      control &&
      (control instanceof HTMLInputElement ||
        (control instanceof HTMLButtonElement && control.type === "submit") ||
        /sign.?in|log.?in|continue|next|sign.?up|register|войти|продолжить|далее/iu.test(
          control.textContent ?? "",
        ))
    )
      capture("form" in control ? control.form : null, false);
  };
  const key = (event: KeyboardEvent) => {
    if (
      event.isTrusted &&
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement
    )
      capture(event.target.form, false);
  };
  document.addEventListener("submit", submit, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  const observer = new MutationObserver(scan);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "type",
      "hidden",
      "style",
      "class",
      "autocomplete",
      "disabled",
      "readonly",
      "name",
      "id",
    ],
  });
  const ready = () => {
    void refresh();
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
  window.addEventListener("focus", ready);
  window.addEventListener("pageshow", ready);
  return {
    refresh,
    dispose() {
      disposed = true;
      accounts = [];
      pending = null;
      picker.dispose();
      if (successTimer) clearTimeout(successTimer);
      observer.disconnect();
      document.removeEventListener("submit", submit, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("DOMContentLoaded", ready);
      window.removeEventListener("focus", ready);
      window.removeEventListener("pageshow", ready);
    },
  };
}
