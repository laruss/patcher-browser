/** Observe focus only. No field values, keyboard events or page API are involved. */
export function observePasswordFocus(
  report: (protect: boolean) => void,
  protectUnknownFocus: boolean,
  restoreLifecycleListeners: () => void,
): () => void {
  const roots = new Set<ShadowRoot>();
  let previous: boolean | undefined;
  let queued = false;
  let stopped = false;
  const observer = new MutationObserver(schedule);
  const observation = {
    attributes: true,
    attributeFilter: ["type"],
    childList: true,
    subtree: true,
  };
  observer.observe(document, observation);

  function read(): boolean {
    if (!document.hasFocus()) return false;
    let active = document.activeElement;
    while (active?.shadowRoot !== null && active?.shadowRoot !== undefined) {
      const root = active.shadowRoot;
      if (!roots.has(root)) {
        roots.add(root);
        observer.observe(root, observation);
      }
      root.addEventListener("focusin", schedule, true);
      root.addEventListener("focusout", schedule, true);
      if (root.activeElement === null) break;
      active = root.activeElement;
    }
    if (active instanceof HTMLInputElement) return active.type === "password";
    if (
      active === null ||
      active === document.documentElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      active instanceof HTMLButtonElement ||
      active instanceof HTMLAnchorElement
    )
      return false;
    // An iframe or opaque shadow host can contain a password field we cannot see.
    return protectUnknownFocus;
  }

  function update(): void {
    queued = false;
    if (stopped) return;
    // document.open() removes DOM event listeners without rerunning the preload.
    // The surviving MutationObserver restores them after the document rewrite.
    for (const name of ["focusin", "focusout", "visibilitychange"]) {
      document.addEventListener(name, schedule, true);
    }
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", schedule);
    restoreLifecycleListeners();
    const protect = read();
    if (protect !== previous) {
      previous = protect;
      report(protect);
    }
  }
  function schedule(): void {
    if (queued || stopped) return;
    queued = true;
    queueMicrotask(update);
  }
  update();
  return () => {
    stopped = true;
    observer.disconnect();
    for (const root of roots) {
      root.removeEventListener("focusin", schedule, true);
      root.removeEventListener("focusout", schedule, true);
    }
    for (const name of ["focusin", "focusout", "visibilitychange"]) {
      document.removeEventListener(name, schedule, true);
    }
    window.removeEventListener("focus", schedule);
    window.removeEventListener("blur", schedule);
  };
}
