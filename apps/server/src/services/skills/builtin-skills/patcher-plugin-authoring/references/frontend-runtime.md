# Frontend runtime: host components, hooks, composer, UI kit, styling

What plugin components are built from. Registration and slot props live in
[frontend-slots.md](frontend-slots.md).

- [Host components](#host-components)
- [Hooks](#hooks)
- [Composer customizations](#composer-customizations)
- [UI components](#ui-components)
- [Styling](#styling)

## Host components

- `ThreadChat` — Patcher's complete chat surface for an existing thread, rendered
  wherever plugin React runs (nav panels, thread-panel tabs, homepage and
  settings sections). This is the deliberate exception to the
  no-host-components rule: a stable product capability, not a UI kit. Props:
  `{ threadId, variant?, layout?, focusRequest?, permissionPolicy?,
className?, leadingContent?, messageActions? }` —
  `variant` is `"full"` (standard chat controls, default), `"compact"`
  (side-panel presentation), or `"timeline"` (transcript without a
  composer); `layout` is `"contained"` (fills and scrolls within the
  parent, default) or `"document"` (grows with page content);
  `focusRequest` is a change-detected nonce that focuses the composer;
  `permissionPolicy` is `"inherit"` (default — sends run with the thread's
  own resolved permission mode and the picker renders as a dimmed label, so
  a plugin surface can never widen permissions) or `"editable"` (the
  instance gets a live picker, letting the user set a mode for this thread
  independently of the one it was forked from);
  `leadingContent` is a `ReactNode` rendered above the conversation,
  scrolling with it; `messageActions` is a list of
  `ThreadChatMessageAction` entries `{ id, title, icon?, roles?, run }`
  rendered in this instance's per-message action bar after the native and
  slot-registered actions — `roles` limits the action to `"user"` and/or
  `"assistant"` messages (omitted = both), and `run(message)` receives the
  same narrow `ThreadChatMessageReference` as the `messageAction` slot;
  errors from `run` are contained and logged, never breaking the timeline.
  Unlike the global `messageAction` slot, these actions are scoped to the
  one `ThreadChat` instance that supplied them. The
  host owns timeline loading, streaming, drafts, send/queue/steer/stop,
  attachments, execution controls, pending interactions, and read tracking —
  do not proxy thread data through your own RPC or rebuild the composer.
- `Markdown` — Patcher's chat-message markdown renderer (same typography,
  spacing, and code styling as timeline messages). Props:
  `{ content, className? }`. Use it wherever plugin UI quotes or previews
  message content (e.g. a reply header) so it reads like the rest of the
  chat instead of a differently-styled bundled renderer. Renderer options
  beyond content/className stay host-internal.
- `experimental_NewThreadComposer` — Patcher's complete compose surface for
  CREATING a thread (the create-side counterpart to `ThreadChat`): prompt
  editor with @-mentions and expand, `+` attachments,
  provider/model/reasoning picker, voice, submit, and the row beneath with
  project, environment, "Branch from:", and permission mode. Never
  hand-roll a textarea + "Start thread" button. Props:
  `{ onSubmit, defaultProjectId?, defaultProviderId?, defaultModel?,
defaultReasoningLevel?, defaultServiceTier?, defaultPermissionMode?,
defaultEnvironment?, initialPrompt?, placeholder?, layout?, focusRequest?,
className?, draftKey? }` — the `default*` props are SEEDS, not controlled
  values: the user can change every one, and each takes precedence over the
  project's remembered defaults when provided. They are value-compared each
  render; changing any of them after mount re-seeds every selection
  (including ones the user touched), so switching between two saved records
  in one mounted composer reloads that record's values. `initialPrompt`
  seeds the draft only while it is still empty; `layout` is `"contained"`
  (default) or `"document"` like `ThreadChat`; `focusRequest` is a
  change-detected nonce that focuses the editor; `draftKey` picks where the
  draft persists (default: a key scoped to your plugin).

  Store-then-restore: because `onSubmit`'s `NewThreadRequest` fields map
  1:1 onto the `default*` props, a plugin that saves a request (e.g. an
  editable rule or template) can re-open it later with
  `defaultProviderId={saved.providerId}` / `defaultModel={saved.model}` /
  `defaultReasoningLevel={saved.reasoningLevel}` /
  `defaultServiceTier={saved.serviceTier}` /
  `defaultPermissionMode={saved.permissionMode}` /
  `defaultEnvironment={saved.environment}` (plus `defaultProjectId` and
  `initialPrompt`), and an untouched resubmit reproduces an equivalent
  request — the composer never silently resets a saved configuration to
  project defaults. Limits (documented on `defaultEnvironment`): a
  `project-default` environment seeds nothing, and a seeded host/worktree
  that no longer exists falls back to the composer's default environment.

  The composer resolves selections; YOUR PLUGIN creates the thread. On
  submit it calls `onSubmit(request)` with a JSON-serializable
  `NewThreadRequest`
  `{ projectId, providerId, model, reasoningLevel, permissionMode,
serviceTier?, executionInputSources, environment, input }`. Forward it
  verbatim to your backend rpc and hand it to `patcher.sdk.threads.spawn`,
  adding `sectionId` / `parentThreadId` / `title` / `visibility` yourself —
  `spawn` fills in `origin: "plugin"` and `originPluginId`, so threads
  created this way stay attributed to your plugin. The draft clears when
  `onSubmit` resolves and is KEPT if it throws, so a failed create never
  loses what the user typed.

  Alias it on import — JSX reads a lowercase-initial name as an intrinsic
  element, so `<experimental_NewThreadComposer />` does not compile:

  ```tsx
  // app.tsx
  import { experimental_NewThreadComposer as NewThreadComposer } from "@patcher/plugin-sdk/app";

  <NewThreadComposer
    defaultProjectId={projectId}
    onSubmit={async (request) => {
      await rpc.call("createThread", { request, sectionId });
    }}
  />;
  ```

  ```ts
  // server.ts
  async createThread({ request, sectionId }) {
    const thread = await patcher.sdk.threads.spawn({
      ...request,
      ...(sectionId ? { sectionId } : {}),
    });
    return { threadId: thread.id };
  }
  ```

  Experimental: the `experimental_` prefix will drop once the entry in
  `docs/api_to_audit.md` is audited. Give it real width — the control row
  does not fit in a ~420px column. Full reference:
  `examples/plugins/cascade`.

## Hooks

- `useRpc<typeof rpcContract>()` → `{ call(method, input?) }` — exact method,
  input, and result inference from a type-only backend contract import.
- `useRealtime(channel, handler)` — fires for this plugin's
  `patcher.realtime.publish(channel, …)` signals while mounted.
- `useRealtimeConnectionState()` — returns `"connecting"`, `"connected"`, or
  `"reconnecting"` for the same shared socket used by `useRealtime`. Reconcile
  durable server state on subsequent transitions to `connected` (not the first
  connection) because plugin signals are ephemeral and are not replayed.
- `useSettings()` → `{ values, isLoading }` — effective non-secret values
  (secret settings are excluded; read them server-side only).
- `usePatcherContext()` → `{ projectId, threadId }` from the current route.
- `usePatcherNavigate()` → `{ toThread(id), toProject(id), toPluginPanel(path,
{ subPath?, replace? }?), toCompose({ initialPrompt?, focusPrompt? }?),
openThreadPanel({ actionId, title?, params? }) }`.
  `toCompose` opens the root compose screen; pass `initialPrompt` to seed the
  composer draft and `focusPrompt: true` to focus it. The panel
  opener opens one of the current plugin's registered `threadPanelAction` tabs
  in the current thread surface and returns whether the host accepted it; it
  returns false on surfaces without a thread side panel.
- `useComposer()` → programmatic access to the chat composer draft (the
  same one the built-in "Add to chat" affordances write to):
  `text` is the current plain text; `setText(next)` replaces it;
  `updateText(current => next)` receives the latest committed text; and
  `clear()` clears the text. These edits preserve attachments. Inline
  mentions outside the changed range are preserved and rebased, while a
  mention overlapped by replaced text is removed because its inline text no
  longer represents that pill. Text edits do not focus the composer;
  `addQuote(text)` appends the text as a `> ` blockquote block and focuses
  the composer — the "reference this selection in chat" primitive;
  `setTextEffect({ className })` paints the whole editable draft with a class
  from the plugin stylesheet (`null` clears it); `setInputLock(locked)` makes
  the editor read-only and busy and auto-releases when the customization
  unmounts or changes scope;
  `insertMention({ provider, id, label })` inserts an @-mention pill bound
  to one of YOUR `patcher.ui.registerMentionProvider` providers, resolved to
  fresh context at send time; `focus()` focuses the caret; `scope` reports
  where writes land (`{ kind: "thread", threadId }` inside a thread
  context, `{ kind: "new-thread", projectId }` from nav panels and
  homepage sections — those seed the composer the user lands on next).
- `useComposerView()` → reactive `{ scope, layout, draft, run }` for the
  composer instance that mounted an action or banner. `layout` is
  `"expanded" | "compact" | "zen"`; `draft` is
  `{ text, isEmpty, attachmentCount }`; `run` is
  `{ isRunning, isSubmitting }`.

```tsx
const composer = useComposer();
composer.updateText((current) => `${current}\n\nPlease summarize this.`);
```

## Composer customizations

- Register with `app.composer.customize({ id, scopes?, actions?, plusMenu?,
banners?, richText? })`. Omitted `scopes` means all thread, queued-message,
  side-chat, and new-thread composers.
- `actions` and `banners` are plugin React components. Calls to
  `useComposer()` and `useComposerView()` inside them are bound to the composer
  that mounted the component. Actions render before native voice/submit and
  are unavailable in compact layout; banners render above the composer.
- `plusMenu` rows are host-rendered so keyboard navigation, focus restoration,
  and mobile layout remain correct. Each `ComposerPlusMenuItem` supplies
  `id`, `label`, optional `icon`, `description`, and `disabled`, plus
  `run({ composer, view })`.
- `richText.effects` rules return plain-text `{ from, to }` ranges and a class
  name from plugin CSS. Decorations are paint-only and never mutate the draft.
  `richText.onDraftChange(draft, view)` observes the debounced
  `ComposerStructuredDraft`, including mention ranges.
- Use a vendored Patcher prompt icon-button recipe for native-matching action chrome
  and provide an accessible label. Each component/callback is isolated so one
  failing customization does not degrade the native composer. Complete
  reference: `examples/plugins/composer-customization`.

## UI components

**Vendored shadcn source you own** (the shadcn model; the
old host-provided component kit is REMOVED — `@patcher/plugin-sdk/app` exports
only `definePluginApp` + the hooks):

- Builtin plugins in this repo import shared UI from `@patcher/shared-ui` (the
  single source of truth the app also consumes and the registry generates
  from); external and example plugins still vendor source through the registry.
- `patcher plugin new --app` pre-vendors button, card, input, dialog (plus their
  support files: `lib/utils`, `lib/portal-scope`, icon, responsive-overlay,
  drawer, hooks) into `components/ui/` etc., and writes a `components.json`
  whose `@patcher` registry is pinned to the release tag matching the running
  Patcher. Import via the `@/*` alias: `import { Button } from
"@/components/ui/button"` (tsconfig maps it; `patcher plugin build` reads it).
- Add more with stock shadcn tooling: `npx shadcn add @patcher/select
@patcher/table` — the Patcher registry carries the full stock set (~44 items:
  accordion, alert-dialog, calendar, chart, command, form, sheet, table,
  …), generated from the Patcher app's own component source, so vendored code is
  version-matched to your Patcher by construction. Edit the copies freely; they
  never change out from under you. Re-running `shadcn add` is the manual
  update path.
- `toast`: `import { toast } from "sonner"` — runtime-shimmed to the host's
  Toaster (`toast.success("Saved")` just works; never mount your own
  `<Toaster>`).
- Never bundled (runtime-shimmed, import freely): react, the portaling
  radix families (`@radix-ui/react-dialog`, `-alert-dialog`, `-popover`,
  `-select`, `-dropdown-menu`, `-context-menu`, `-menubar`, `-hover-card`,
  `-tooltip`, `-navigation-menu`), `sonner`, `vaul`, `@pierre/diffs` (+
  `/react`). Your vendored overlays therefore share the host's
  dismissable-layer/focus/scroll-lock world — stacking against host
  overlays behaves correctly.
- Syntax-highlighted diffs: `parsePatchFiles` from `@pierre/diffs` +
  `FileDiff` from `@pierre/diffs/react` render patches exactly like the
  app's own diff panel (the host provides the highlighting worker pool via
  React context on every plugin surface; add `@pierre/diffs` to
  devDependencies for types). Synthesize a `diff --git a/<p> b/<p>` header
  when your patch source (e.g. the GitHub REST API) omits it — see
  `plugins/github/app.tsx`.
- Everything else bundles from YOUR `node_modules` (hugeicons, lucide,
  cva/clsx/tailwind-merge, form/calendar/chart libs): run `npm install`
  after adding components (`patcher plugin new` runs the first one; `shadcn add`
  installs each item's declared deps). Consumers never need npm — ship your
  built `dist/`.
- Styling: Tailwind classes compile against the host theme's live CSS
  variables (`bg-background`, `text-muted-foreground`, `rounded-lg`, and
  `animate-in`/`fade-in-0` via tw-animate-css) — derive colors from theme
  tokens, never hardcoded grays.
- The old Patcher extras (`EmptyState`, `Markdown`, `PageBody`, `Spinner`) are
  gone — write your own (each is a few lines; see
  `plugins/github/components/` for reference implementations).

One deviation from stock shadcn: `Dialog` renders as a bottom drawer on
compact viewports (the host's responsive behavior) — same API.

## Styling

Tailwind classes compile against the host theme's live CSS
variables — use host token classes (`bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border`, `text-destructive`, …). Never
define custom `@theme` colors and never hand-set `oklch(...)`/gray
literals: the build's Tailwind pass emits default-theme utilities only, and
hardcoded colors break custom palettes.
