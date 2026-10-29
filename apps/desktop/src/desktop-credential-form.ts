import { randomUUID } from "node:crypto";
import type { SiteTarget } from "./desktop-site-authority.js";

// Executes only in a dedicated main-frame isolated world. No page prototypes,
// snapshot refs, plugin selectors, input commands or command traces.
export const credentialFormExpression = String.raw`(() => {
  const d = document, url = location.href;
  const visible = e => {
    for (let node = e; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.inert || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return false;
    }
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return r.width > 0 && r.height > 0 && s.visibility === 'visible' && s.display !== 'none' &&
      x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && d.elementFromPoint(x, y) === e;
  };
  const candidates = [...d.forms].filter(f => f.querySelectorAll('input[type="password"]').length === 1);
  if (candidates.length !== 1 || d.querySelectorAll('input[type="password"]').length !== 1) throw Error('Unsupported credential form');
  const f = candidates[0], p = f.querySelector('input[type="password"]');
  const users = [...f.querySelectorAll('input')].filter(e => e.type === 'text' || e.type === 'email');
  if (users.length > 1) throw Error('Ambiguous credential form');
  const u = users[0] || null, action = f.action, username = u ? u.value : '';
  const check = () => {
    if (document !== d || location.href !== url || !f.isConnected || !p.isConnected || p.ownerDocument !== d ||
      p.form !== f || p.type !== 'password' || p.matches(':disabled') || p.readOnly || p.autocomplete.split(/\s+/).includes('new-password') || !visible(p) ||
      f.action !== action || new URL(action).origin !== location.origin ||
      f.querySelectorAll('input[type="password"]').length !== 1 || f.querySelector('input[type="password"]') !== p ||
      d.querySelectorAll('input[type="password"]').length !== 1 ||
      [...f.querySelectorAll('input')].filter(e => e.type === 'text' || e.type === 'email').length !== (u ? 1 : 0) ||
      (u && (!u.isConnected || u.ownerDocument !== d || u.form !== f || !['text','email'].includes(u.type) || u.matches(':disabled') || u.readOnly || !visible(u) || u.value !== username)))
      throw Error('Credential form changed');
  };
  check();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  return {
    p,
    metadata() { check(); const r=p.getBoundingClientRect(); return { username, x:r.x+r.width/2, y:r.y+r.height/2 }; },
    capture(token) { check(); if (!globalThis.__patcherCredentialRelease.take(token, 'capture')) throw Error('Release refused'); const password = p.value; if (!password || password.length > 4096) throw Error('Unsupported password'); return { username: u ? u.value : '', password }; },
    fill(token) {
      check();
      const value = globalThis.__patcherCredentialRelease.take(token, 'fill');
      if (!value) throw Error('Release refused');
      // Both assignments precede any event capable of running page handlers.
      if (u) setter.call(u, value.username);
      setter.call(p, value.password);
      const intact = () => document === d && location.href === url && f.isConnected && p.isConnected && p.form === f && p.type === 'password' && f.action === action && (!u || (u.isConnected && u.form === f));
      for (const e of u ? [u,p] : [p]) for (const kind of ['input','change']) {
        if (!intact()) return true;
        e.dispatchEvent(new Event(kind, { bubbles:true }));
      }
      return true;
    }
  };
})()`;

async function bounded<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new Error("Cancelled");
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export async function prepareCredentialForm(
  target: SiteTarget,
  assert: () => void,
  signal: AbortSignal,
  prepareToken: string,
) {
  const page = target.credentials;
  if (!page) throw new Error("Unavailable");
  const id = randomUUID();
  const execute = async (code: string) => {
    assert();
    const value = await bounded(page.execute(code), signal);
    assert();
    return value;
  };
  const close = async () => {
    try {
      await bounded(
        page.execute(
          `globalThis.__patcherCredentialForms?.delete(${JSON.stringify(id)})`,
        ),
        AbortSignal.timeout(250),
      );
    } catch {
      /* Best-effort cleanup cannot retain a cancelled channel request. */
    }
  };
  try {
    const metadata = (await execute(`(() => {
      if (!globalThis.__patcherCredentialRelease?.take(${JSON.stringify(prepareToken)}, "prepare")) throw Error("Preparation refused");
      const forms = globalThis.__patcherCredentialForms ??= new Map();
      if (forms.size >= 16) throw Error("Busy");
      const form = ${credentialFormExpression};
      forms.set(${JSON.stringify(id)}, form);
      setTimeout(() => forms.delete(${JSON.stringify(id)}), 120000);
      return form.metadata();
    })()`)) as { username?: unknown; x?: unknown; y?: unknown };
    if (
      typeof metadata?.username !== "string" ||
      metadata.username.length > 1024 ||
      typeof metadata.x !== "number" ||
      typeof metadata.y !== "number"
    )
      throw new Error("Unsupported");
    const node = (await bounded(
      page.send("DOM.getNodeForLocation", {
        x: Math.round(metadata.x),
        y: Math.round(metadata.y),
        includeUserAgentShadowDOM: false,
      }),
      signal,
    )) as { backendNodeId?: number };
    assert();
    if (typeof node.backendNodeId !== "number") throw new Error("Unsupported");
    page.rememberPassword(node.backendNodeId);
    const call = (method: "capture" | "fill", token: string) =>
      execute(
        `globalThis.__patcherCredentialForms.get(${JSON.stringify(id)}).${method}(${JSON.stringify(token)})`,
      );
    return {
      username: metadata.username,
      capture: (token: string) =>
        call("capture", token) as Promise<{
          username: string;
          password: string;
        }>,
      fill: (token: string) => call("fill", token),
      close,
    };
  } catch {
    await close();
    throw new Error("Unsupported credential form");
  }
}
