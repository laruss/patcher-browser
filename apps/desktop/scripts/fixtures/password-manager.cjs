const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { join } = require("node:path");

// Compose the shipped manager with the real main-process vault and HTTPS page.
// The server's SQL, grants and caller attribution have separate process tests.
module.exports = async function managerSmoke({
  root,
  runtime,
  vault,
  sites,
  policy,
  backend,
  page,
  context,
  evaluate,
  form,
  login,
  sentinel,
  settlePending,
  resetApproval,
}) {
  const manager = (await import(join(root, "manager.mjs"))).default;
  let handlers, dispose, script;
  let connected = true;
  const records = new Map();
  const events = [];
  const metadata = (record) => {
    // Select the public contract explicitly, independently of sealed internals.
    return Object.fromEntries(
      [
        "id",
        "version",
        "origin",
        "accountId",
        "username",
        "protection",
        "createdAt",
        "updatedAt",
      ].map((key) => [key, record[key]]),
    );
  };
  const request = async (input, { signal }) => {
    if (!connected) return { status: "unavailable" };
    const lease = await sites.request(
      "site.context",
      {
        owners: [{ pluginId: policy.pluginId, revision: policy.revision }],
        tabId: input.tabId,
      },
      signal,
    );
    try {
      const record = input.reference && records.get(input.reference.id);
      if (input.reference && record?.version !== input.reference.version)
        return { status: "denied" };
      const response = await vault.request(
        "credential.operation",
        {
          token: lease.token,
          owner: policy.pluginId,
          sourceHash: "a".repeat(64),
          request: input,
          ...(record
            ? { record }
            : { draft: { id: randomUUID(), createdAt: Date.now() } }),
        },
        signal,
      );
      if (response.record) records.set(response.record.id, response.record);
      if (response.result.status === "deleted")
        records.delete(input.reference.id);
      return response.result;
    } finally {
      await sites.request(
        "site.release",
        { token: lease.token },
        new AbortController().signal,
      );
    }
  };
  manager({
    browser: {
      getStatus: () => ({ connected }),
      page: { getUrl: async () => page().getURL() },
      credentials: {
        list: async () => [...records.values()].map(metadata),
        request,
      },
      registerPageScript: (value) => {
        script = value;
      },
      registerToolbarItem() {},
    },
    rpc: {
      register: (_contract, value) => {
        handlers = value;
      },
    },
    realtime: {
      publish: (topic, value) => {
        events.push({ topic, value });
      },
    },
    onDispose: (value) => {
      dispose = value;
    },
  });
  const target = { tabId: "tab", origin: context.origin };
  const propose = async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    resetApproval();
    let settled = false;
    const promise = handlers
      .request({ ...target, requestId: randomUUID(), ...input })
      .then((value) => {
        settled = true;
        return value;
      });
    const pending = await settlePending(vault);
    assert.equal(settled, false, "manager must await real native approval");
    return { pending, promise };
  };
  await form();
  for (const accountId of ["personal", "work"]) {
    await evaluate(
      `document.getElementById('password').value = ${JSON.stringify(sentinel + accountId)}`,
    );
    const proposal = await propose({ operation: "save", accountId });
    assert.equal(
      (await vault.review(proposal.pending.id, page().id)).status,
      "saved",
    );
    assert.deepEqual(await proposal.promise, { status: "saved" });
  }
  const view = await handlers.view(target);
  assert.equal(view.accounts.length, 2);
  assert(!JSON.stringify(view).includes(sentinel));
  const restored = runtime.createCredentialKeyStore(
    join(root, "vault", "key.bin"),
    backend,
  );
  const work = view.accounts.find((account) => account.accountId === "work");
  assert.equal(
    restored.open(records.get(work.id), (value) => value),
    sentinel + "work",
  );
  await evaluate("document.getElementById('password').value = ''");
  const fill = await propose({
    operation: "fill",
    reference: { id: work.id, version: work.version },
  });
  assert.equal(await evaluate("document.getElementById('password').value"), "");
  await vault.review(fill.pending.id, page().id);
  assert.deepEqual(await fill.promise, { status: "filled" });
  assert.equal(
    await evaluate("document.getElementById('password').value"),
    sentinel + "work",
  );
  await evaluate(
    `document.getElementById('password').value = ${JSON.stringify(sentinel + "changed")}`,
  );
  const update = await propose({
    operation: "update",
    reference: { id: work.id, version: work.version },
  });
  await vault.review(update.pending.id, page().id);
  assert.deepEqual(await update.promise, { status: "updated" });
  assert.equal(records.get(work.id).version, 2);
  const stale = await handlers.request({
    ...target,
    requestId: randomUUID(),
    operation: "fill",
    reference: { id: work.id, version: 1 },
  });
  assert.deepEqual(stale, { status: "denied" });
  await form("<p>Signed in — no login form</p>");
  const deletion = await propose({
    operation: "delete",
    reference: { id: work.id, version: 2 },
  });
  await vault.review(deletion.pending.id, page().id);
  assert.deepEqual(await deletion.promise, { status: "deleted" });
  assert.equal(records.size, 1);
  connected = false;
  assert.deepEqual(await handlers.view(target), {
    status: "unavailable",
    accounts: [],
  });
  assert.deepEqual(
    await handlers.request({
      ...target,
      requestId: randomUUID(),
      operation: "save",
      accountId: "locked",
    }),
    { status: "unavailable" },
  );
  connected = true;
  await form();
  const aborted = await propose({ operation: "save", accountId: "disabled" });
  dispose();
  assert.deepEqual(await aborted.promise, { status: "cancelled" });
  assert.equal(records.size, 1);
  assert.equal(vault.list(page().id).length, 0);
  assert(!JSON.stringify([...records.values()]).includes(sentinel));
  console.log(
    "PASS manager: two approved accounts, OS-sealed key restart, selected fill/update/delete, stale reference, unavailable backend, disable cancels and retains records",
  );

  // Run the shipped observer in the public plugin world of the real HTTPS page.
  await page().executeJavaScriptInIsolatedWorld(9001, [
    {
      code: `globalThis.patcher = {ready: (fn) => fn(), rpc: async (method, input) => { (globalThis.hints ??= []).push({method,input}); return {ok:true}; }}; ${script.code}`,
    },
  ]);
  const hints = () =>
    page().executeJavaScriptInIsolatedWorld(9001, [
      { code: "JSON.stringify(globalThis.hints)" },
    ]);
  assert.deepEqual(JSON.parse(await hints())[0].input, {
    origin: context.origin,
    kind: "form",
    present: true,
  });
  await form("<p>No form</p>");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(JSON.parse(await hints()).at(-1).input.present, false);
  await form(login);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(JSON.parse(await hints()).at(-1).input.present, true);
  assert(!String(await hints()).includes(sentinel));
  assert.equal(events.length, 0);
  console.log(
    "PASS real isolated-world manager hints: dynamic forms, origin/kind/present only, no credential proposals",
  );
};
