const { app, BrowserWindow, webContents, session } = require("electron");
const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const root = process.env.PATCHER_SITE_ACCESS_ROOT,
  dist = process.env.PATCHER_SITE_ACCESS_DIST;
const {
  createDesktopBrowserViewManager,
  PATCHER_BROWSER_PARTITION,
  createDesktopSiteAuthority,
  siteDigest,
  registerDesktopBrowserIpc,
  registerDesktopSiteIpc,
  executeScopedBrowserCommand,
  createCdpSession,
  runBrowserSiteOperation,
} = require(join(root, "runtime.cjs"));
app.setPath("userData", join(root, "profile"));
process.on("uncaughtException", (error) => {
  console.error("Uncaught site fixture error", error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("Unhandled site fixture rejection", error);
  process.exit(1);
});
const servers = [];
let manager;
const results = [];
const deadline = setTimeout(
  () => finish(new Error("site access fixture deadline")),
  50_000,
);
function finish(error) {
  clearTimeout(deadline);
  manager?.destroyAll();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  for (const server of servers) server.close();
  if (error) console.error(error, results);
  else
    console.log(
      JSON.stringify({ electron: process.versions.electron, results }, null, 2),
    );
  app.exit(error ? 1 : 0);
}
async function waitFor(check, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}
async function serve(body, auth) {
  const server = createServer((req, res) => {
    if (auth && /\/(?:private|public)\/auth/.test(req.url)) {
      if (
        req.headers.authorization !==
        "Basic " + Buffer.from("user:sentinel").toString("base64")
      ) {
        res.writeHead(401, { "WWW-Authenticate": `Basic realm="${req.url}"` });
        res.end("Authenticate");
        return;
      }
      auth();
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body());
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
(async () => {
  await app.whenReady();
  const originB = await serve(
    () =>
      '<!doctype html><input value="iframe-only-secret"><button>IFRAME_SENTINEL</button>',
  );
  let authRequests = 0;
  const originA = await serve(
    () =>
      `<!doctype html><h1>Hostile page</h1><input id="filled" value="keep this form"><iframe src="${originB}/"></iframe><script>window.bridgeExposed = typeof window.patcher !== 'undefined' || typeof require !== 'undefined';</script>`,
    () => {
      authRequests++;
    },
  );
  const host = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await host.loadURL("data:text/html,host");
  let authority;
  manager = createDesktopBrowserViewManager({
    pageScriptPreloadPath: join(dist, "page-script-preload.cjs"),
    siteAuthority: () => authority,
    dispatchAppCommand() {},
    downloadPathExists: () => false,
    extractPdfText: async () => ({ ok: false, reason: "unreadable" }),
    focusHostWebContents() {},
    openDownloadPath: async () => "",
    openExternalUrl() {},
    revealDownloadPath() {},
    resolveDownloadDirectory: () => root,
    resolveAppCommand: () => null,
  });
  authority = createDesktopSiteAuthority({
    resolve: manager.resolveSiteTarget,
    confirm: async () => false,
    changed: manager.sitePolicyChanged,
    cancelAuth: (target, id) => {
      void manager.respondToPagePrompt({
        hostWindow: host,
        request: {
          tabId: target.context.tabId,
          id,
          answer: { kind: "cancel" },
        },
      });
    },
  });
  registerDesktopBrowserIpc(manager);
  registerDesktopSiteIpc({
    manager,
    current: () => authority,
    authorize: () => false,
  });
  let replies = 0;
  const send = host.webContents.send.bind(host.webContents);
  host.webContents.send = (channel, payload) => {
    if (channel !== "patcher-desktop:browser:site-scoped-page-call")
      return send(channel, payload);
    void (async () => {
      try {
        await authority.request(
          "site.redeem",
          {
            token: payload.token,
            pluginId: payload.pluginId,
            digest: siteDigest({
              pluginId: payload.pluginId,
              method: payload.method,
              input: payload.input,
            }),
          },
          new AbortController().signal,
        );
        await authority.request(
          "site.check",
          { token: payload.token },
          new AbortController().signal,
        );
        replies++;
        manager.respondToPageScriptCall({
          result: {
            callId: payload.callId,
            ok: true,
            result: '"backend-answer"',
          },
        });
      } catch {
        manager.respondToPageScriptCall({
          result: { callId: payload.callId, ok: false, message: "Refused" },
        });
      }
    })();
  };
  const script = {
    pluginId: "fixture",
    scriptId: "hostile",
    matches: [`${originA}/**`, `${originB}/**`],
    code: `patcher.ready(() => { document.body.dataset.injected = "yes"; setInterval(async () => { document.body.dataset.ticks = String(Number(document.body.dataset.ticks || 0) + 1); try { await patcher.rpc("probe", {}); document.body.dataset.reply = "yes"; } catch { document.body.dataset.denied = "yes"; } }, 40); });`,
  };
  let policy = {
    pluginId: "fixture",
    name: "Fixture",
    revision: randomUUID(),
    enabled: true,
    sites: script.matches,
    origins: [],
    permissions: [
      "tabs.read",
      "page.read",
      "page.inject",
      "pageScript.register",
    ],
    scripts: [siteDigest(script)],
    styles: [],
  };
  async function policyUpdate(origins) {
    policy = { ...policy, revision: randomUUID(), origins };
    await authority.request(
      "site.policy",
      policy,
      new AbortController().signal,
    );
  }
  await policyUpdate([]);
  authority.setContributions({ scripts: [script], styles: [] });
  manager.attach({
    hostWindow: host,
    request: {
      tabId: "tab",
      url: `${originA}/`,
      bounds: { x: 0, y: 0, width: 700, height: 500 },
      visible: false,
    },
  });
  // Open both test origins so these checks exercise site grants independently of the loopback network firewall.
  session
    .fromPartition(PATCHER_BROWSER_PARTITION)
    .webRequest.onBeforeRequest((_details, callback) =>
      callback({ cancel: false }),
    );
  const page = webContents
    .getAllWebContents()
    .find((contents) => contents.id !== host.webContents.id);
  await waitFor(
    () => page.getURL() === `${originA}/` && !page.isLoadingMainFrame(),
    "initial load",
  );
  assert.equal(
    await page.executeJavaScript("document.body.dataset.injected"),
    undefined,
  );
  assert.equal(replies, 0);
  assert.equal(await page.executeJavaScript("window.bridgeExposed"), false);
  results.push("no injection/RPC before grant; web page has no Patcher bridge");
  await policyUpdate([originA]);
  const loaded = once(page, "did-finish-load");
  manager.reload({ hostWindow: host, tabId: "tab" });
  await loaded;
  await waitFor(
    () => page.executeJavaScript("document.body.dataset.reply === 'yes'"),
    "granted RPC",
  );
  const subframe = page.mainFrame.framesInSubtree.find((frame) =>
    frame.url.startsWith(originB),
  );
  assert(subframe);
  assert.equal(
    await subframe.executeJavaScript(
      "document.body.textContent.includes('IFRAME_SENTINEL')",
    ),
    true,
  );
  assert.equal(
    await subframe.executeJavaScript(
      "Boolean(document.body?.dataset.injected)",
    ),
    false,
  );
  results.push(
    "grant permits main-frame RPC; other-origin iframe receives no runtime world",
  );
  const command = {
    type: "page.snapshot",
    tabId: "tab",
    maxDepth: null,
    selector: null,
  };
  const lease = await authority.request(
    "site.prepare",
    {
      owners: [{ pluginId: "fixture", revision: policy.revision }],
      tabId: "tab",
      digest: siteDigest(command),
    },
    new AbortController().signal,
  );
  const snapshot = await executeScopedBrowserCommand({
    manager,
    authority,
    hostWindow: host,
    token: lease.token,
    command,
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.value.snapshot.includes("IFRAME_SENTINEL"), false);
  results.push("native scoped snapshot excludes cross-origin iframe contents");
  // All fixture exports share one bundle/ALS instance, just as desktop main does.
  const target = page.debugger;
  const guarded = createCdpSession({
    target: {
      isAttached: () => false,
      attach() {},
      detach() {},
      sendCommand: target.sendCommand.bind(target),
      on: target.on.bind(target),
      off: target.off.bind(target),
    },
  });
  const frames = await target.sendCommand("Page.getFrameTree");
  const childFrame = frames.frameTree.childFrames.find((frame) =>
    frame.frame.url.startsWith(originB),
  ).frame;
  const childWorld = await target.sendCommand("Page.createIsolatedWorld", {
    frameId: childFrame.id,
    worldName: "fixture-child",
  });
  const childNode = await target.sendCommand("Runtime.evaluate", {
    expression: 'document.querySelector("input")',
    contextId: childWorld.executionContextId,
  });
  const described = await target.sendCommand("DOM.describeNode", {
    objectId: childNode.result.objectId,
  });
  await subframe.executeJavaScript(
    `Object.defineProperty(Node.prototype, 'ownerDocument', { configurable: true, get() { return { location: { href: ${JSON.stringify(originA + "/")} } }; } });`,
  );
  await assert.rejects(
    runBrowserSiteOperation(
      () => {},
      () =>
        guarded.send("DOM.resolveNode", {
          backendNodeId: described.node.backendNodeId,
        }),
      originA + "/",
    ),
  );
  const documentTree = await target.sendCommand("DOM.getDocument");
  const input = await target.sendCommand("DOM.querySelector", {
    nodeId: documentTree.root.nodeId,
    selector: "#filled",
  });
  await runBrowserSiteOperation(
    () => {},
    () => guarded.send("DOM.resolveNode", { nodeId: input.nodeId }),
    originA + "/",
  );
  guarded.detach();
  results.push(
    "private intrinsic proof rejects a child node even with spoofed ownerDocument, and accepts the main node",
  );

  await policyUpdate([]);
  const afterRevoke = replies;
  await waitFor(
    () => page.executeJavaScript("document.body.dataset.denied === 'yes'"),
    "RPC refusal after revoke",
  );
  assert.equal(replies, afterRevoke);
  assert.equal(
    await page.executeJavaScript("document.querySelector('#filled').value"),
    "keep this form",
  );
  assert.deepEqual(manager.siteCleanup(), [
    { pluginId: "fixture", tabId: "tab" },
  ]);
  results.push(
    "old hostile JS still runs; backend replies stop; filled form is preserved; cleanup is pending",
  );
  const reloaded = once(page, "did-finish-load");
  manager.reload({ hostWindow: host, tabId: "tab" });
  await reloaded;
  assert.equal(
    await page.executeJavaScript("document.body.dataset.injected"),
    undefined,
  );
  assert.deepEqual(manager.siteCleanup(), []);
  results.push("explicit reload removes the old script and clears cleanup");
  let navigation = 0;
  async function load(url) {
    url += `?fixtureNavigation=${++navigation}`;
    const loaded = once(page, "did-finish-load");
    manager.navigate({ hostWindow: host, request: { tabId: "tab", url } });
    await loaded;
    await waitFor(
      () => page.getURL() === url && !page.isLoadingMainFrame(),
      "fresh navigation",
    );
  }
  await policyUpdate([originA]);
  await load(originA + "/private/base");
  policy = {
    ...policy,
    sites: [originA + "/private/**"],
    permissions: [...policy.permissions, "auth.provide"],
  };
  await policyUpdate([originA]);
  async function challenge(path) {
    manager.navigate({
      hostWindow: host,
      request: { tabId: "tab", url: originA + path },
    });
    await waitFor(
      () => manager.resolveSiteTarget("tab")?.authPrompt?.(),
      "native auth prompt",
    );
    return manager.resolveSiteTarget("tab").authPrompt().id;
  }
  let id = await challenge("/public/auth-outside");
  await assert.rejects(
    authority.request(
      "site.context",
      {
        owners: [{ pluginId: "fixture", revision: policy.revision }],
        tabId: "tab",
        authPromptId: id,
      },
      new AbortController().signal,
    ),
  );
  await manager.respondToPagePrompt({
    hostWindow: host,
    request: { tabId: "tab", id, answer: { kind: "cancel" } },
  });
  await load(originA + "/private/base");
  id = await challenge("/private/auth-revoke");
  const answer = {
    kind: "credentials",
    username: "user",
    password: "sentinel",
  };
  let authTicket = await authority.request(
    "site.auth",
    {
      owners: [{ pluginId: "fixture", revision: policy.revision }],
      tabId: "tab",
      id,
      digest: siteDigest(answer),
    },
    new AbortController().signal,
  );
  await policyUpdate([]);
  assert.throws(() =>
    authority.consumeAuth(
      { token: authTicket.token, tabId: "tab", id, answer },
      host.webContents.id,
    ),
  );
  assert.equal(authRequests, 0);
  assert.equal(manager.resolveSiteTarget("tab")?.authPrompt?.() ?? null, null);
  await policyUpdate([originA]);
  await load(originA + "/private/base");
  id = await challenge("/private/auth-success");
  authTicket = await authority.request(
    "site.auth",
    {
      owners: [{ pluginId: "fixture", revision: policy.revision }],
      tabId: "tab",
      id,
      digest: siteDigest(answer),
    },
    new AbortController().signal,
  );
  const authenticated = once(page, "did-finish-load");
  assert.equal(
    authority.consumeAuth(
      { token: authTicket.token, tabId: "tab", id, answer },
      host.webContents.id,
    ),
    true,
  );
  await manager.respondToPagePrompt({
    hostWindow: host,
    request: { tabId: "tab", id, answer },
  });
  await authenticated;
  assert.throws(() =>
    authority.consumeAuth(
      { token: authTicket.token, tabId: "tab", id, answer },
      host.webContents.id,
    ),
  );
  assert.equal(authRequests, 1);
  results.push(
    "native auth rejects an outside-ceiling challenge and delayed revoked answer; valid delivery succeeds once",
  );

  finish();
})().catch(finish);
