import type { PageAccount } from "./password-manager-page-ipc.js";

/** Only account metadata enters this closed shadow tree. Keeping the input
 * focused lets people type, erase and navigate suggestions as in Chrome. */
export function createPasswordAccountPicker() {
  let host: HTMLDivElement | null = null;
  let anchor: HTMLInputElement | null = null;
  let choices: PageAccount[] = [];
  let rows: HTMLButtonElement[] = [];
  let selected = 0;
  let choose: ((account: PageAccount) => void) | undefined;
  function hide() {
    host?.remove();
    host = null;
    anchor = null;
    rows = [];
    choices = [];
    choose = undefined;
  }
  function position() {
    if (!host || !anchor?.isConnected) {
      hide();
      return;
    }
    const bounds = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(bounds.width, 240), innerWidth - 16);
    const widthCss = `${width}px`,
      leftCss = `${Math.max(8, Math.min(bounds.left, innerWidth - width - 8))}px`;
    if (host.style.width !== widthCss) host.style.width = widthCss;
    if (host.style.left !== leftCss) host.style.left = leftCss;
    const height = Math.min(choices.length * 40 + 40, 300);
    const topCss = `${bounds.bottom + height + 8 < innerHeight ? bounds.bottom + 4 : Math.max(8, bounds.top - height - 4)}px`;
    if (host.style.top !== topCss) host.style.top = topCss;
  }
  function highlight() {
    rows.forEach((row, index) => {
      row.setAttribute("aria-selected", String(index === selected));
    });
    rows[selected]?.scrollIntoView?.({ block: "nearest" });
  }
  function select(index: number) {
    const account = choices[index],
      callback = choose;
    hide();
    if (account) callback?.(account);
  }
  function show(
    input: HTMLInputElement,
    accounts: PageAccount[],
    callback: (account: PageAccount) => void,
  ) {
    hide();
    if (!accounts.length || !input.isConnected) return;
    anchor = input;
    choices = accounts;
    choose = callback;
    selected = 0;
    host = document.createElement("div");
    host.setAttribute("popover", "manual");
    host.setAttribute("role", "listbox");
    host.setAttribute("aria-label", "Saved passwords");
    host.style.cssText =
      "all:initial;position:fixed;margin:0;padding:0;border:0;z-index:2147483647;display:block;background:transparent;";
    const root = host.attachShadow({ mode: "closed" });
    const css = `:host{color-scheme:light dark}section{font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:light-dark(#fff,#292a2d);color:light-dark(#202124,#e8eaed);border:1px solid #8885;border-radius:10px;box-shadow:0 4px 16px #0004;overflow:auto;max-height:300px;padding:6px 0;box-sizing:border-box}header{font-size:11px;opacity:.65;padding:6px 14px}button{display:block;width:100%;padding:11px 14px;text-align:left;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button[aria-selected=true]{background:light-dark(#e8f0fe,#3c4043)}`;
    if (typeof CSSStyleSheet.prototype.replaceSync === "function") {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement("style");
      style.textContent = css;
      root.append(style);
    }
    const section = document.createElement("section"),
      title = document.createElement("header");
    title.textContent = "Password Manager";
    section.append(title);
    rows = accounts.map((account, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.setAttribute("role", "option");
      row.tabIndex = -1;
      row.textContent = account.username || "No username";
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("mouseenter", () => {
        selected = index;
        highlight();
      });
      row.addEventListener("click", () => select(index));
      section.append(row);
      return row;
    });
    root.append(section);
    document.documentElement.append(host);
    position();
    highlight();
    host.showPopover?.();
  }
  function outside(event: Event) {
    if (event.target !== anchor && host && event.target !== host) hide();
  }
  function key(event: KeyboardEvent) {
    if (!event.isTrusted || !host || event.target !== anchor) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selected =
        (selected + (event.key === "ArrowDown" ? 1 : choices.length - 1)) %
        choices.length;
      highlight();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      select(selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      hide();
    } else if (event.key === "Tab") hide();
  }
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("blur", hide);
  window.addEventListener("scroll", position, true);
  window.addEventListener("resize", position);
  return {
    show,
    hide,
    update() {
      if (!anchor?.isConnected) hide();
      else position();
    },
    dispose() {
      hide();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    },
  };
}
