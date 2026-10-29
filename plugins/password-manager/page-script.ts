import type { PluginPageScriptApi } from "@patcher/plugin-sdk";

// Self-contained: the host runs this function's source in the plugin world.
// It never reads a field value, injects a banner or invokes a vault operation.
export function observeLoginForms(patcher: PluginPageScriptApi) {
  if (window !== window.top || location.protocol !== "https:") return;
  patcher.ready(() => {
    const visible = (node: HTMLInputElement) => {
      if (
        node.matches(":disabled") ||
        node.readOnly ||
        node.getClientRects().length === 0
      )
        return false;
      for (
        let parent: Element | null = node;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          parent.hasAttribute("hidden") ||
          parent.hasAttribute("inert") ||
          style.display === "none" ||
          style.visibility !== "visible" ||
          Number(style.opacity) === 0
        )
          return false;
      }
      return true;
    };
    const candidate = () => {
      const passwords = [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[type="password"]',
        ),
      ];
      if (passwords.length !== 1) return null;
      const password = passwords[0]!;
      const form = password.form;
      if (
        !form ||
        !visible(password) ||
        password.autocomplete.split(/\s+/).includes("new-password")
      )
        return null;
      if (new URL(form.action, location.href).origin !== location.origin)
        return null;
      const usernames = [...form.elements].filter(
        (node) =>
          node instanceof HTMLInputElement &&
          (node.type === "text" || node.type === "email"),
      );
      if (
        usernames.length > 1 ||
        usernames.some((node) => !visible(node as HTMLInputElement))
      )
        return null;
      return form;
    };
    let last: HTMLFormElement | null | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const report = (kind: "form" | "submit", present: boolean) => {
      void patcher
        .rpc("hint", { origin: location.origin, kind, present })
        .catch(() => {});
    };
    const scan = () => {
      timer = undefined;
      const form = candidate();
      if (form !== last) {
        last = form;
        report("form", form !== null);
      }
    };
    const observer = new MutationObserver(() => {
      if (timer === undefined) timer = setTimeout(scan, 250);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "type",
        "disabled",
        "readonly",
        "hidden",
        "inert",
        "style",
        "class",
        "action",
        "autocomplete",
        "form",
      ],
    });
    const submit = (event: Event) => {
      if (event.isTrusted && event.target === candidate())
        report("submit", true);
    };
    document.addEventListener("submit", submit, true);
    window.addEventListener(
      "pagehide",
      () => {
        observer.disconnect();
        document.removeEventListener("submit", submit, true);
        if (timer !== undefined) clearTimeout(timer);
      },
      { once: true },
    );
    scan();
  });
}
