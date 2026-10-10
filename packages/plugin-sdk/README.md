# @patcher/plugin-sdk

The typed facade Patcher plugin authors compile against. The root preserves the
complete `PatcherPluginApi` and `PatcherSdk` contract; `./app` is the frontend runtime
that `patcher plugin build` replaces with Patcher's shared implementation.

The authoritative contracts are the exported declarations in
[`src/backend-contract.ts`](src/backend-contract.ts) and
[`src/app-contract.ts`](src/app-contract.ts). Keep author-facing guidance in
the built-in `patcher-plugin-authoring` skill synchronized with those declarations.

## Composer customization

Composer UI extensions register through `app.composer.customize(...)`. A
`ComposerCustomization` can contribute React action and banner components,
host-rendered `ComposerPlusMenuItem` rows, and `ComposerRichTextSpec` rules.
Mounted components use `useComposer()` for writes, effects, and input locking,
and `useComposerView()` for the reactive scope, layout, draft, and run state.
Any mounted plugin component can use
`usePatcherNavigate().openThreadPanel(...)` to request one of the
same plugin's registered thread-panel actions; it returns false when the
current surface has no thread side panel.

See the
[`composer-customization` reference plugin](../../examples/plugins/composer-customization/README.md)
for every region in one small app. The deprecated pre-1.0
`app.slots.composerAccessory(...)` footer API has been removed; migrate footer
controls to actions or the plus menu and larger content to banners.

## Trusted frontend content scripts

Use `app.contentScripts.register({ id, mount })` for ordinary
bundled TypeScript/JavaScript that enhances the Patcher app shell without rendering
a React slot. The host supplies `{ pluginId, generation, signal }`, awaits
mount setup, and owns abort plus exact-once reverse-order disposal across hash
reload, disable, removal, failed replacement, and app-window teardown. The old
generation is disposed before candidate mounts, so generations never overlap.
Content scripts are trusted same-origin page code, not a sandbox.

Static styles should stay in the normal imported `app.css`; scripts may own
dynamic DOM/style nodes when their disposer removes them. See the
[`content-script` reference plugin](../../examples/plugins/content-script/README.md)
for a cleanup-safe editor enhancement.

## Runtime browser site access

SDK 1.1.0 adds opt-in `patcher.siteAccess: "runtime"` in the plugin manifest.
Declare `engines.patcherPluginSdk: "^1.1.0"` (minimum 1.1.0), the required
permissions, and `patcher.sites` as the URLs the plugin may request. Legacy
plugins keep their existing site semantics. Registration matches still must name
declared patterns verbatim.

The user chooses **Allow here** in browser site info and confirms in a native
desktop dialog. Access requires both a matching actual page URL and a persisted
grant for its exact origin; schemes, subdomains and non-default ports are
separate. Plugin detail shows permissions, declared sites, grants and Revoke.
Source identity, permission or ceiling changes require new confirmation. Disable
blocks access while preserving grants; uninstall removes them.

Runtime browser calls require an explicit tab ID. The first version supports
URL/title/text/selection reads, snapshots, interaction, scroll, evaluate and
viewport screenshots. Session storage/cookies, routing/offline, recording,
console/network history, PDF/full-page capture, tab management and navigation
are unavailable. Runtime scripts/RPC run only in the main frame; DOM and AX
reads exclude other-origin frames. A viewport screenshot includes visible iframe
pixels, and pointer input acts on the rendered page. These grants govern Patcher
APIs; installed Node plugins still run with the user's local process privileges.

A connected, owned desktop server and a shell/SPA with the new optional scoped
API are required. Headless, attached/remote and older combinations refuse runtime
page operations. Normal backend RPC cannot approve a grant or create trusted
page context. The testing fake host is a behavior harness, not a simulation of
native grants; use the server and Electron fixtures for access enforcement.

Runtime HTTP auth providers need `auth.provide` and a grant covering the actual
native challenge URL. Patcher checks every coalesced request URL, keeps proxy and
origin challenges separate, and binds the returned credentials to a one-use
native delivery capability. Navigation or revoke before delivery refuses the
answer. Older shells cannot use runtime auth providers; manual entry and legacy
providers retain their existing behavior.

Revoke cancels pending capabilities and blocks new backend calls. Previously
injected JavaScript can remain in the page: Patcher reports pending cleanup and
provides an explicit Reload page action, preserving filled forms until the user
chooses it. Scripts registered or newly allowed on an open page run on its next
load. Protected credential operations have their own scope below.

SDK 1.3.0 adds optional `browserTabId?: string | null` to leading-panel props,
paired with `browserUrl` from the same active tab in that window. Treat it as a
target identifier, not consent or approval. Older hosts omit it; credential UI
must refuse operations without a tab ID.

## Protected browser credentials

SDK 1.2.0 adds `patcher.browser.credentials`. Declare minimum SDK 1.2.0,
`patcher.siteAccess: "runtime"`, a matching `patcher.sites` ceiling and
`credentials.manage`. The person must grant the exact origin first.

`list({ tabId })` returns account metadata and opaque `{ id, version }` references
for your plugin/source and the live origin. `request` proposes an operation in
core browser chrome; it awaits the person's Review and native confirmation.

```ts
const saved = await patcher.browser.credentials.request({
  operation: "save",
  tabId,
  accountId: "primary",
});
// From a later user action, after choosing one of list({ tabId })'s accounts:
const filled = await patcher.browser.credentials.request({
  operation: "fill",
  tabId,
  reference: { id: account.id, version: account.version },
});
```

Update/Delete use the same reference shape. Save/Update return metadata;
Fill/Delete return status only. Handle `cancelled`, `denied`, `unavailable`,
`unsupported` and `busy`; never retry automatically. Pass `{ signal }` as the
second argument to cancel a request. There is no password parameter, getter,
selector, approved flag, origin override, reveal, export or clipboard API.

Only the owned desktop server and current core chrome can approve. Each action
uses the sealed policy chosen at Save: Require Touch ID fails closed when
unavailable/cancelled; Confirm every action is an explicit separate choice.
Agents, page RPC and external callers are refused, including calls through child/SDK
HTTP delegation. Every authenticated deputy needs its own runtime permission
and site grant; legacy deputies cannot use another manager's authority.

The MVP accepts one visible enabled password input and at most one username/email
input in a main-frame HTTPS form with same-origin action. Hidden/readonly,
ambiguous, signup/password-change, iframe and closed-shadow forms are unsupported.
Exact nodes are rechecked before capture/fill; both values are assigned before
page events. Fill neither submits nor retries after node replacement. Once in
the DOM, the site and permitted page scripts can read the password.

Requests expire within 120 seconds; parent call deadlines can cancel earlier.
Navigation, hide, lock, revoke, disable and broker disconnect cancel them. Encrypted records remain after disable/uninstall;
reinstall requires the same owner/source identity and fresh grants. Missing OS
key never recreates a vault over existing ciphertext. Headless/remote/old hosts
refuse this capability; the testing fake host does not simulate native approval.

## External plugin tests

The packed package includes executable JavaScript and portable declarations
for `@patcher/plugin-sdk/testing` and `@patcher/plugin-sdk/testing/app`; neither subpath
imports Patcher workspace packages or source TypeScript at runtime. Install the SDK
with the test stack used by your plugin (the peer dependencies are optional so
headless plugins do not install a browser harness):

```sh
npm install --save-dev @patcher/plugin-sdk vitest better-sqlite3 zod
npm install --save-dev react react-dom @testing-library/react jsdom # frontend tests
```

Backend example:

```ts
import { createFakePluginHost } from "@patcher/plugin-sdk/testing";
import plugin from "./server.js";

const host = createFakePluginHost({ pluginId: "notes" });
await plugin(host.patcher);

await host.harness.behavior.callRpc("list", { query: "today" });
expect(host.harness.inspection.registrations.rpcMethods).toContain("list");
await host.harness.lifecycle.dispose();
```

`harness.behavior` contains deterministic host inputs (RPC/HTTP/CLI calls,
events, settings, tools, interactions, and schedules), `harness.inspection`
contains registrations and recorded state, and `harness.lifecycle` owns atomic
reload and disposal. Every pre-existing direct member remains as an alias for
source compatibility. A successful `reload(factory)` preserves settings, KV,
and database state and invalidates the old API only after the replacement
factory succeeds; a failed factory leaves the old load live.

Frontend example (`// @vitest-environment jsdom`):

```tsx
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@patcher/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));
const scripts = await mountPluginContentScripts(app, { pluginId: "notes" });
const slot = renderSlot(
  app.homepageSections[0]!,
  { projectId: "proj_1" },
  {
    rpc: { list: () => [] },
    context: { projectId: "proj_1", threadId: null },
  },
);

await slot.behavior.emitRealtime("notes-changed", null);
expect(slot.inspection.rpcCalls).toHaveLength(1);
slot.lifecycle.unmount();
await scripts.lifecycle.dispose();
```

`loadPluginApp` installs the runtime before a thunk import and validates all
registrations. `mountPluginContentScripts` mirrors the host's ordered mount,
rollback, independent per-window signal, and exact-once disposal. `renderSlot` supplies
RPC, realtime, settings, navigation, context, and scoped composer behavior,
then returns Testing Library queries plus the same behavior/inspection/lifecycle
split. Use a setup-file `installTestPluginRuntime()` only when a static app
import is unavoidable.

## Fidelity boundaries

The backend fake matches observable schema-RPC validation/errors and strict
JSON results, additive events, keyed-registration failures, atomic reload,
settings, KV/database storage, conditional agent configuration, request input,
and disposal order. HTTP runs through Hono but does not enforce Patcher's local or
token authentication. Background services and schedules run only when driven;
there are no restart timers or cron sweeps. Storage is process-local in a
temporary directory, secrets are kept in memory, `patcher.sdk` is always bound and
unstubbed calls throw, and cross-plugin/global collision policy is outside one
fake host.

The frontend harness matches registration validation, content-script mount and
cleanup ordering, RPC/realtime JSON
boundaries, panel and slot props, navigation recording, and composer text,
scope, quote, mention, focus, and clear behavior. It does not reproduce Patcher
layout, CSS, persistence, routing, host authentication, crash boundaries, or
multi-plugin arbitration; use a live Patcher test for those boundaries.

## Declaration surface

The complete root declaration flattens the unpublished Patcher workspace contracts.
The testing declarations reuse that public `@patcher/plugin-sdk` root instead of
embedding a second copy, and no declaration depends on unpublished `@patcher/*`
packages. Genuine npm types (`hono`, `better-sqlite3`, `zod`, React, and Testing
Library) remain peer imports. Scaffolded plugins still vendor the root/app
declarations in `types/`; installing this package is needed only when their
tests import the testing subpaths.
