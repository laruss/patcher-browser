# Frontend: the `patcher.app` entry, slots, and content scripts

Where plugin React mounts inside the Patcher app, what each slot receives, and how
the host loads and disposes a frontend generation. Read
[frontend-runtime.md](frontend-runtime.md) for the hooks, host components, and
UI kit those components are built from.

- [The app entry](#the-app-entry)
- [A control in the thread header](#a-control-in-the-thread-header)
- [Replacing the sidebar thread list](#replacing-the-sidebar-thread-list)
- [Trusted frontend content scripts](#trusted-frontend-content-scripts)
- [Slot props contracts](#slot-props-contracts)
- [Crash isolation and the `run` pattern](#crash-isolation)

## The app entry

`app.tsx` default-exports `definePluginApp` from `@patcher/plugin-sdk/app`.
React and the SDK are **never bundled** — `patcher plugin build` shims them to
the host's shared runtime, so the bundle only works inside Patcher.

```tsx
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  useSettings,
  usePatcherContext,
  usePatcherNavigate,
  useComposer,
  useComposerView,
} from "@patcher/plugin-sdk/app";
import { toast } from "sonner"; // shimmed to the host toaster
import { Button } from "@/components/ui/button"; // vendored source YOU own
import { Dialog, DialogContent } from "@/components/ui/dialog";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "editor-enhancement",
    mount({ pluginId, generation, signal }) {
      const onKeyDown = (event: KeyboardEvent) => {
        // Ordinary trusted, same-origin DOM behavior.
      };
      document.addEventListener("keydown", onKeyDown, { signal });
      return () => document.removeEventListener("keydown", onKeyDown);
    },
  });
  app.slots.homepageSection({
    id: "issues",
    title: "Open issues",
    component: IssuesSection,
  });
  app.slots.settingsSection({
    id: "settings",
    title: "Connection",
    description: "Configure the remote service used by this plugin.",
    component: SettingsSection,
  });
  app.slots.navPanel({
    id: "board",
    title: "Board",
    icon: "Columns",
    path: "board",
    component: Board,
    experimental_sidebarAccessory: OpenIssueCount,
  });
  app.slots.experimental_leadingPanel({
    id: "board-rail",
    title: "Board",
    icon: "Columns",
    component: BoardPanel,
    // Optional: draw the column only while the active browser tab is here.
    matches: ["https://github.com/**"],
  });
  app.slots.threadPanelAction({
    id: "issue",
    title: "Open issue",
    component: IssuePanel,
    run: async ({ threadId, openPanel }) =>
      openPanel({ title: `Issue for ${threadId}` }),
  });
  app.slots.experimental_newThreadPanelAction({
    id: "template",
    title: "Apply template",
    component: TemplatePanel,
    run: ({ projectId, openPanel }) =>
      openPanel({ title: `Template for ${projectId ?? "projectless"}` }),
  });
  app.composer.customize({
    id: "prompt-tools",
    actions: [{ id: "improve", component: ImprovePromptAction }],
    plusMenu: [
      {
        id: "append-checklist",
        label: "Append checklist",
        run: ({ composer }) =>
          composer.updateText(
            (current) => `${current}\n\n- Verify behavior\n- Run checks`,
          ),
      },
    ],
    banners: [{ id: "workflow", component: WorkflowBanner }],
    richText: {
      effects: [
        {
          id: "todo",
          className: "plugin-todo-highlight",
          match: (text) =>
            Array.from(text.matchAll(/\bTODO\b/g), (match) => ({
              from: match.index,
              to: match.index + match[0].length,
            })),
        },
      ],
    },
  });
  app.slots.pendingInteraction({
    id: "credentials",
    component: CredentialForm,
  });
  app.slots.sidebarFooterAction({
    id: "reconnect",
    title: "Reconnect",
    icon: "Key",
    run: ({ openSettings }) => openSettings(),
  });
  app.slots.messageDirective({ id: "inline-vis", component: InlineVis });
  app.slots.experimental_threadList({
    id: "inbox",
    title: "Inbox",
    description: "One flat list, newest thread on top.",
    component: InboxList,
  });
});
```

## A control in the thread header

`app.slots.experimental_threadHeaderAction` renders a component in the thread
header's action row. It replaced the older backend-only
`patcher.ui.registerThreadAction`, so a control that needs to draw live state (a
count, a cluster, a status) is now the only shape:

```tsx
app.slots.experimental_threadHeaderAction({
  id: "subagents",
  title: "Subagents",
  component: ({ threadId, projectId, isCompactViewport }) => { ... },
});
```

The row is a 48px chrome row with 28px controls: render ONE inline control, and
put anything taller in a portalled popover. The host clamps your footprint, so
an oversized control is clipped rather than allowed to break the header. `title`
names the host's wrapper region — your icon-only button still needs its own
accessible name. A split layout renders one header
per pane, so your component mounts once per visible thread — keep per-thread
state in the component, never in a module-level singleton.

A common pairing with a replaced sidebar: hide child threads from the list and
surface them here instead, filtering `experimental_useSidebarThreads()` by
`parentThreadId === threadId`.

## Replacing the sidebar thread list

`app.slots.experimental_threadList` is the one **exclusive** slot: only one
list fills the sidebar's scroll area. Registering it does not take the sidebar
— the built-in list stays the default, and the user picks a provider in
**Settings → Appearance → Sidebar**. The choice is per client.

Your component gets the scrolling list and nothing else. The New-thread button,
the search field, the plugin nav rows, and the footer stay host-rendered —
other plugins live in two of those, so a replaced list must not remove them.
Put your own controls at the top of your scroll area instead.

If the chosen plugin is disabled, uninstalled, or its component throws, Patcher
renders its own list again (plus a toast on a crash), so the sidebar is never
empty.

The component receives:

```ts
interface PluginThreadListProps {
  activeThreadId: string | null;
  activeProjectId: string | null;
  isCompactViewport: boolean;
  /** Closes the mobile drawer and clears the host search field. Always call it
      after opening a thread, or the sidebar stays in search mode. */
  onNavigate: () => void;
  /** The host search field's text; "" when the field is closed. The host owns
      that field — filter by this rather than shipping a second one. */
  searchQuery: string;
}
```

**Reading and acting on threads.** Two hooks back a replaced list:

```tsx
const { status, threads, projects } = experimental_useSidebarThreads();
const actions = experimental_useSidebarThreadActions();

// threads: PluginSidebarThread[] — id, title, parentThreadId, originKind,
// providerId, activity counts, isUnread/isPinned, environment.branchName,
// host ({ id, name } — the machine, useful when a thread has no branch),
// timestamps, and
// `indicator` (Patcher's resolved status kind) + `indicatorLabel` (its a11y string).
// Draw your own glyph for `indicator`; the SDK ships no status component.
// Treat an unknown indicator value as "none" — Patcher adds kinds over time.

// Pull requests are per row and opt-in — a lookup hits the git host, so it is
// deliberately NOT on the thread payload every sidebar loads:
const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
// → { number, title, url, state, attention } | null

actions.open(id, { split: true }); // Patcher's split placement rules
actions.openNewThread({ projectId }); // also sets the composer's project
actions.setPinned(id, true);
actions.setRead(id, false);
actions.rename(id, "New title"); // silent; for inline editing
actions.archive(id); // archives children too, closes their panes
actions.requestDelete(id); // opens Patcher's delete confirmation
```

Destructive actions deliberately route through the host's own flow, so there
is no silent `delete`: deletion is recursive, and only Patcher can show the
confirmation that counts the child threads.

Unit-test a list with `renderSlot(...)` from `@patcher/plugin-sdk/testing/app`:
seed rows with the `sidebarThreads` option and assert against
`inspection.sidebarActionCalls`.

**Splits.** Rows can drag out to the split area:

```tsx
const { splitProps, isAvailable, layout } =
  experimental_useSidebarThreadSplit(thread.id);

<a {...splitProps} onClick={...}>
  {title}
  {/* layout is data: draw a mini-map, a tint, or nothing */}
</a>;
```

The host owns the gesture rules, including the one that matters if your list
has its own drag-to-reorder: a split drag engages only once the pointer leaves
the sidebar.

**Your row, your menu.** This API ships no components. Build your own context
menu from `experimental_useSidebarThreadActions` — it exposes everything Patcher's
own menu does, including `requestDelete`, which opens Patcher's confirmation.

**Keyboard support is a DOM contract.** Patcher's thread shortcuts find rows by
query selector, not by React state. Put both attributes on each row's anchor or
the surface-specific numbered shortcuts, `thread.next`, and `thread.previous`
silently stop working:

```tsx
<a data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id}>
```

## Trusted frontend content scripts

`app.contentScripts.register({ id, mount })` runs ordinary
bundled JavaScript/TypeScript in the Patcher app shell without a React slot. It is
full-trust, same-origin page code — **not a security sandbox**. It can access
the app DOM and any authenticated client state available to ordinary page
code, so install only plugins you trust. Patcher does not use `eval`, `Function`,
or persisted source strings: the existing `patcher.app` build emits a normal CSP-
compatible ESM bundle.

The host mounts scripts in registration order after the bundle loads and
`definePluginApp` setup validates. `mount` receives
`{ pluginId, generation, signal, experimental_setThreadRowStatus?, experimental_setBrowserTabStatus? }`:
`generation` is a monotonic per-window mount attempt number, and `signal`
aborts before cleanup starts. The two optional experimental setters are the
host's decorator points, and both take `{ icon, label, tone? }` or `null` to
clear:

- `experimental_setThreadRowStatus(threadId, status)` marks a thread row in the
  sidebar.
- `experimental_setBrowserTabStatus(tabId, status)` marks a **browser tab** in
  the browser surface's strip, beside its page icon and title. Tab ids come from
  the backend side (`patcher.browser.tabs.list()`, or a tab action's context — see
  [browser.md](browser.md)); marking an id the strip does not hold is not an
  error, it simply shows nowhere.

Use `tone: "running"` for the host's animated running treatment. The host
scopes statuses to the calling plugin and automatically clears them when that
frontend generation deactivates; feature-detect the setters for compatibility
with older Patcher clients.

```ts
app.contentScripts.register({
  id: "mark-tabs",
  mount({ signal, experimental_setBrowserTabStatus }) {
    experimental_setBrowserTabStatus?.("browser:abc123", {
      icon: "Zap",
      label: "Syncing this tab",
      tone: "running",
    });
    signal.addEventListener("abort", () => {
      // Not required — the host clears this generation's marks itself — but
      // clearing early is how a mark stops meaning something that is over.
      experimental_setBrowserTabStatus?.("browser:abc123", null);
    });
  },
});
```

A script may return nothing, a disposer, or a promise of either; async mount
setup is time-boxed to 10 seconds. Keep long-running work outside the returned
promise, observe `signal`, and catch failures in work the host does not await.

A replacement bundle and setup validate before lifecycle cutover. The host
then aborts and disposes the prior generation before mounting candidate scripts,
so listeners and observers never overlap. If a mount throws or rejects, the
host aborts that candidate, disposes already-mounted candidate scripts in
reverse registration order, and publishes none of its slots or CSS. Import or
setup failure also deactivates stale UI because the corresponding backend may
already have been replaced. Disable, stop, removal, and app-window teardown
follow the same abort-then-reverse-dispose path; every returned disposer is
called at most once. Each desktop window, browser tab, and remote client owns
an independent instance.

Synchronous and awaited asynchronous mount/dispose failures are contained and
logged; they cannot stop sibling plugins from activating. The current
window's last load/setup/mount/dispose failure appears on the plugin Settings
detail page. The host cannot catch a detached promise that plugin code creates
and never returns, so detached work must handle its own errors.

Prefer the existing imported `app.css` pipeline for static styles. A content
script may create DOM or `<style>` nodes when behavior genuinely requires it,
but its abort handler/disposer must remove every node, observer, listener,
timer, and class it owns. The context deliberately has no route/project/thread
snapshot yet; use stable SDK hooks inside React slots rather than polling or
installing global navigation observers. Complete cleanup-safe example:
`examples/plugins/content-script`.

## Slot props contracts

Versioned and additive-only:

- `homepageSection` → `{ projectId: string | null }` (project in view on
  the compose surface). Registration: `{ id, title, component }`.
- `settingsSection` → `{}` (deliberately no props in V1). Rendered on the
  plugin detail page below the host-rendered declarative settings
  form for running, needs-configuration, and degraded plugins. Registration:
  `{ id, title?, description?, component }`; `title` is an optional host-rendered
  section heading and `description` is optional supporting copy rendered with
  that heading. Use the existing hooks (`useRpc`, `useRealtime`,
  `useRealtimeConnectionState`, `useSettings`, `usePatcherNavigate`, `usePatcherContext`)
  for data. Enabled plugins appear in the
  settings sidebar when they declare settings descriptors OR register
  settings sections.
- `experimental_leadingPanel` → `{ browserUrl: string | null }` — a panel on the
  window's **leading** edge, the end opposite the sidebar. Registration:
  `{ id, title, icon, component, matches? }`. It is not a route: nothing links to
  it, it has no path, and it stays put while the user navigates — use it for
  something that accompanies the work rather than somewhere the user goes.
  Patcher contributes nothing to this edge, so it does not exist until a plugin
  claims it, and what the host draws around it follows from how many plugins
  did: one gets the panel whole with no host chrome, and a second is what makes
  the host add a rail of icons to switch between them. `title` names the rail
  button; `icon` is a Patcher icon name. The user can resize the panel; the plugin
  does not choose its width.
  `matches` scopes the panel to pages: URL globs (`["https://github.com/**"]`,
  `**` crossing `/`), and the host draws the column only while the **active
  browser tab** is on a matching page. Declare it rather than returning `null`
  from the component for pages you do not want — an empty column still reserves
  the edge. `browserUrl` is that tab's address, or null when the window is not
  showing a page; with `matches` declared it is non-null whenever the panel
  renders. Costs no permission: this is Patcher's own UI reacting to the address bar,
  unlike `patcher.sites`, which governs reaching into a page.
- `navPanel` → `{ subPath: string }` — owns the whole route at
  `/plugins/<pluginId>/<path>/*` and gets its own sidebar entry. `subPath`
  is the route remainder after the panel root (`""` at the root), so deep
  links like `/plugins/notes/notes/work/ideas.md` land with
  `subPath: "work/ideas.md"`. Navigate within the panel via
  `usePatcherNavigate().toPluginPanel(path, { subPath, replace? })` — browser
  back/forward then walks panel-internal history (prefer this over hash
  routing).
  Registration:
  `{ id, title, icon, path, component, experimental_sidebarAccessory?, headerContent? }`.
  `experimental_sidebarAccessory` is a no-props, presentational component at
  the trailing edge of the sidebar row. It can own SDK hooks for a live count
  or short status without lifting state into the host sidebar. The host does
  not mount it on compact viewports; on wider viewports it clips the component
  to one line, 4rem wide by 1.25rem high, and ellipsizes ordinary long text.
  It shares the trailing action column and fades out for the host options
  button on row hover or keyboard focus without unmounting. Do not render
  controls or portalled content there. A throw hides only the accessory.
  Experimental: see `docs/api_to_audit.md`.
  The host renders your compact plugin icon + `title` into the SHARED app
  header (the same title bar as Settings pages) with your optional
  `headerContent` component as the header actions on the right — so do NOT
  repeat the title inside your component. The component owns the full-bleed
  body below with zero host padding; add your own padding and scrolling when
  the design needs them. `headerContent` is plugin code inside the host title bar and is
  contained separately: a throw hides the header content without breaking the
  title bar or the panel body. For a classic page, use an outer scroll region
  with `p-4 md:p-5` and wrap its content in a
  `mx-auto w-full max-w-3xl space-y-4` div.
- `threadPanelAction` → an entry in the thread right panel's new-tab
  Actions list (next to "Start side chat" / "Start terminal"), labeled
  `title` with your compact plugin icon. This slot is only offered for an
  existing thread; it never renders on the root New thread screen, and its
  `threadId` stays required. Registration:
  `{ id, title, icon?, component, layout?, run? }`. Activating it calls
  `run({ threadId, openPanel })` — do anything there (rpc, toast), and/or
  call `openPanel({ title?, params? })` to open a closable panel tab
  rendering `component` with `{ threadId: string, params: JsonValue | null }`.
  Omitting `run` opens a tab immediately with defaults. Write parameters are
  typed as the recursively JSON-safe `JsonValue` exported by both
  `@patcher/plugin-sdk` and `@patcher/plugin-sdk/app`; they persist with the tab across reloads (null when
  none was passed); identical action+params re-opens focus the existing
  tab (title refreshed), different params open sibling tabs. The tab pill
  shows your compact plugin icon + the tab title. Errors thrown from `run`
  (sync or async) are contained and logged, never breaking the launcher.
  `layout` frames the tab content: `"padded"` (default) wraps `component`
  in the panel's scroll container with standard padding — right for
  document-like content; `"flush"` gives it the full tab area (no padding,
  definite height, no host scrolling) — right for app-like content that
  owns its layout, such as `ThreadChat`.
- `experimental_newThreadPanelAction` → the root New thread counterpart to
  `threadPanelAction`. It appears in that screen's right-panel Actions list
  and never appears beside an existing thread. Registration has the same
  `{ id, title, icon?, component, layout?, run? }` shape, but activating it
  calls `run({ projectId, openPanel })` and its component receives
  `{ projectId: string | null, params: JsonValue | null }`; `projectId` is
  null in projectless compose. Panel opening, JSON params, layout, persistence,
  deduplication, and error containment otherwise match `threadPanelAction`.
  Experimental: see `docs/api_to_audit.md`.
- Removed pre-1.0: `composerAccessory` was the legacy composer footer. Migrate
  controls to `app.composer.customize({ actions })` or `plusMenu`, larger
  content to `banners`, and legacy `{ projectId, threadId }` prop reads to
  `useComposerView().scope`.
- `pendingInteraction` → `{ interaction, submit, cancel }` — replaces the
  thread composer only while a matching plugin interaction is pending.
  Registration: `{ id, component }`; `id` must equal the backend request's
  `rendererId`. `interaction` contains metadata plus the JSON `payload`;
  `submit(value)` returns the JSON value to the waiting backend invocation,
  while `cancel()` settles it without a value. Keep sensitive field values in
  component state only.
- `sidebarFooterAction` → host-rendered icon button in the app sidebar footer
  (next to Settings / bug report). No plugin component — the host paints
  the chrome so icons stay consistent. Registration:
  `{ id, title, icon, run }`. Activating it calls
  `run({ openSettings })` — use `openSettings()` to open this plugin's
  detail page in Tools, or do anything else (rpc, toast). Errors from `run`
  (sync or async) are contained and logged,
  never breaking the sidebar. `title` is the tooltip + accessible label;
  `icon` is a Patcher icon-name hint (unknown names fall back to a generic bolt).
- `fileOpener` → `{ path: string, source }` — register as a viewer/editor
  for file extensions: `{ id, title, extensions: ["md"], component }`.
  Users set the per-extension default under Settings → "File openers", and
  right-clicking a file link in rendered markdown offers a one-off
  "Open with …" choice; matching files opened in the right panel then
  render your component in a plugin tab instead of the built-in preview —
  this includes links clicked in rendered markdown, the file picker, and
  `patcher thread open`. `source` is
  `{ kind: "workspace" | "host" | "thread-storage", threadId, environmentId,
projectId }` (nullable fields) and `path` follows the source (workspace:
  worktree-relative; host: absolute; thread-storage: storage-relative).
  Applies only to live file content — git-ref snapshots and deleted files
  always use the built-in preview, and a removed/disabled opener degrades
  back to it. Pair with `patcher.sdk.files` (rpc from your server) to load and
  CAS-save the content.
- `messageDirective` → `{ attributes, source, message,
openWorkspaceFile }` — register a leaf
  assistant-message directive. Registration:
  `{ id, component }` where `id` is lowercase kebab-case beginning with a
  letter (e.g. `inline-vis` matches `::inline-vis{file="demo.html"}`).
  Props: `attributes` is a `Readonly<Record<string, string>>` of untrusted
  parsed key/values (validate your own fields); `source` is the original
  directive text (useful for diagnostics); `message` is
  `{ id, threadId, turnId, projectId }` for the enclosing assistant (or
  nested agent) message. `openWorkspaceFile` is either
  `(path: string) => boolean` or `null`; pass it a worktree-relative path to
  open that file in the host's workspace viewer. It is `null` when the message
  surface has no workspace viewer, and it returns whether the host accepted
  the path. To open one of the same plugin's registered `threadPanelAction`
  components, call
  `usePatcherNavigate().openThreadPanel({ actionId, title?, params? })`.
  `params` is typed as `JsonValue`; use normal plugin navigation as the
  fallback when it returns false.
  **Host behavior / fallbacks:** only assistant and
  nested agent Markdown activate directives — user messages, file previews,
  and other Markdown surfaces stay plain. Directives inside inline code or
  fenced code blocks stay literal. Incomplete streaming directives stay
  literal until the closing syntax arrives. Unknown, disabled, malformed,
  conflicting, or crashing directives fall back to rendering the original
  `source` (the component ErrorBoundary still isolates a throw). Treat
  attributes as attacker-controlled even though the model emitted them;
  load workspace data through `patcher.sdk.files` with root/host confinement
  rather than trusting paths. Reference implementation:
  `plugins/inline-vis` (the sidebar's path-shaped, sandboxed worktree
  iframe preview, including relative assets and normal web loading).
- `messageAction` → an action on chat messages: an icon button in the
  per-message action bar (user and assistant messages) and an entry in the
  assistant-message text-selection menu. Host-rendered chrome, no plugin
  component — registration: `{ id, title, icon?, run }`. Activating it calls
  `run(context)` with `{ threadId, message, selectedText?, openPanel }`:
  `message` is a narrow stable reference
  `{ id, threadId, role: "user" | "assistant", text, sourceSeqEnd }` (never
  an internal timeline row); `selectedText` is present only for
  selection-menu invocations and holds the exact highlighted text; and
  `openPanel({ actionId, title?, params? })` opens one of the same plugin's
  registered `threadPanelAction` components in the current thread's side
  panel — same semantics and boolean return as
  `usePatcherNavigate().openThreadPanel`. Errors from `run` (sync or
  async) are contained and
  logged, never breaking the timeline.

## Crash isolation

Each slot mounts inside an ErrorBoundary — a throwing
component collapses to a "plugin <id> crashed" chip; the rest of the app
(and other plugins) stay alive. For `messageDirective`, a throw falls back
to the original directive source text instead of blanking the message.

The `run` pattern (threadPanelAction): `run` is the place to resolve
server state before deciding what to open — e.g. call a backend rpc, then
`openPanel({ title: issue.title, params: { issueId: issue.id } })`, or
`toast.error("No linked issue")` and open nothing. The panel component
should treat `params` as untrusted input (it round-trips through
persistence) and re-fetch fresh data by id rather than embedding whole
payloads in params.
