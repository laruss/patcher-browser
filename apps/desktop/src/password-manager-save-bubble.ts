import { BrowserWindow, nativeTheme } from "electron";

const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
*{box-sizing:border-box}body{font:14px -apple-system,BlinkMacSystemFont,sans-serif;margin:0;padding:24px;background:var(--bg);color:var(--fg)}h1{font-size:19px;font-weight:500;margin:0 0 8px}#site,#username{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#site{font-size:13px;opacity:.65;margin-bottom:22px;overflow-wrap:anywhere}label{display:block;font-size:12px;opacity:.7;margin:14px 0 5px}p{margin:0;overflow-wrap:anywhere}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}button{border:1px solid #8885;border-radius:20px;padding:9px 18px;font:inherit;background:transparent;color:inherit;cursor:pointer}#save{background:#a8c7fa;color:#062e6f;border-color:transparent}button:focus-visible{outline:2px solid #8ab4f8;outline-offset:2px}
</style></head><body><h1 id="title"></h1><div id="site"></div><label>Username</label><p id="username"></p><label>Password</label><p>••••••••</p><div class="actions"><button id="cancel">Not now</button><button id="save"></button></div></body></html>`;

/** A separate native child overlays WebContentsView without reserving a strip
 * of webpage space. Only metadata enters it; the password stays in main. */
export async function showPasswordSaveBubble(args: {
  parent: BrowserWindow;
  origin: string;
  username: string;
  update: boolean;
  signal: AbortSignal;
}): Promise<boolean> {
  if (args.signal.aborted || args.parent.isDestroyed()) return false;
  const bounds = args.parent.getContentBounds();
  const popup = new BrowserWindow({
    parent: args.parent,
    width: 360,
    height: 294,
    x: bounds.x + Math.max(0, bounds.width - 376),
    y: bounds.y + 88,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#202124" : "#fff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  const close = () => {
    if (!popup.isDestroyed()) popup.close();
  };
  args.signal.addEventListener("abort", close, { once: true });
  popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popup.webContents.on("will-navigate", (event) => event.preventDefault());
  let resolveClosed!: (value: boolean) => void;
  const closed = new Promise<boolean>((resolve) => {
    resolveClosed = resolve;
  });
  popup.once("closed", () => resolveClosed(false));
  try {
    await popup.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    if (args.signal.aborted || popup.isDestroyed()) return false;
    const dark = nativeTheme.shouldUseDarkColors;
    const result = popup.webContents
      .executeJavaScriptInIsolatedWorld(1742, [
        {
          code: `(() => {
      document.documentElement.style.setProperty('--bg', ${JSON.stringify(dark ? "#202124" : "#fff")});
      document.documentElement.style.setProperty('--fg', ${JSON.stringify(dark ? "#e8eaed" : "#202124")});
      document.getElementById('title').textContent = ${JSON.stringify(args.update ? "Update password?" : "Save password?")};
      document.getElementById('site').textContent = ${JSON.stringify(args.origin)};
      document.getElementById('site').title = ${JSON.stringify(args.origin)};
      document.getElementById('username').textContent = ${JSON.stringify(args.username || "No username")};
      document.getElementById('username').title = ${JSON.stringify(args.username)};
      document.getElementById('save').textContent = ${JSON.stringify(args.update ? "Update password" : "Save")};
      document.getElementById('save').focus();
      return new Promise(resolve => {
        document.getElementById('save').onclick = () => resolve(true);
        document.getElementById('cancel').onclick = () => resolve(false);
        document.addEventListener('keydown', event => { if (event.key === 'Escape') resolve(false); });
      });
    })()`,
        },
      ])
      .then(
        (value) => value === true,
        () => false,
      );
    popup.show();
    popup.once("blur", close);
    return await Promise.race([result, closed]);
  } catch {
    return false;
  } finally {
    args.signal.removeEventListener("abort", close);
    close();
  }
}
