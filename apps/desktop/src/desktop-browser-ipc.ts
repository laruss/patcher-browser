// Channel names for the desktop-only web browser surface. Renderer → main
// commands drive a hardened, isolated `WebContentsView`; main → renderer pushes
// carry navigation state and popup-open requests. Mirrors the `patcher-desktop:*`
// convention in `desktop-update-ipc.ts`.

export const PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL =
  "patcher-desktop:browser:attach";
export const PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL =
  "patcher-desktop:browser:detach";
export const PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL =
  "patcher-desktop:browser:navigate";
export const PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL =
  "patcher-desktop:browser:go-back";
export const PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL =
  "patcher-desktop:browser:go-forward";
export const PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL =
  "patcher-desktop:browser:reload";
export const PATCHER_DESKTOP_BROWSER_STOP_CHANNEL =
  "patcher-desktop:browser:stop";
export const PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL =
  "patcher-desktop:browser:set-bounds";
export const PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL =
  "patcher-desktop:browser:set-visible";
export const PATCHER_DESKTOP_BROWSER_STATE_CHANNEL =
  "patcher-desktop:browser:state";
export const PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL =
  "patcher-desktop:browser:open-tab";
export const PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL =
  "patcher-desktop:browser:scoped-open-tab";
export const PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL =
  "patcher-desktop:browser:snapshot";
// Tab icons ride their own channel rather than a field on the wire-frozen state
// payload, so an older SPA's strict parser never sees a shape it would reject
// (invariant 2 in docs/architecture/bb-migration.md).
export const PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL =
  "patcher-desktop:browser:favicon";
// What a download did. Its own channel for the reason favicons got one, and one
// more: this is the only main -> renderer push that reports something the shell
// did to the user's filesystem, so it is worth seeing on its own name in a log.
export const PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL =
  "patcher-desktop:browser:download";
// Opening a finished download, or showing it in the file manager. An invoke
// rather than a send because "the file is gone" is worth reporting, and its own
// channel because it is the only browser command that touches a path on disk
// instead of a tab.
export const PATCHER_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL =
  "patcher-desktop:browser:download-action";
// The user asked to print the page. Its own channel because it is the one
// browser command whose whole effect is an OS dialog: nothing comes back, and
// the window is blocked until the user answers it.
export const PATCHER_DESKTOP_BROWSER_PRINT_CHANNEL =
  "patcher-desktop:browser:print";
// Page zoom, and what it became. Two channels because zoom changes from both
// ends: the user asks for a step, and Chromium restores a site's remembered
// zoom on its own when a tab navigates there. Their own channels rather than a
// field on the wire-frozen state payload, for the reason favicons got one.
export const PATCHER_DESKTOP_BROWSER_SET_ZOOM_CHANNEL =
  "patcher-desktop:browser:set-zoom";
export const PATCHER_DESKTOP_BROWSER_ZOOM_CHANNEL =
  "patcher-desktop:browser:zoom";
// The user silenced a tab. One direction only, unlike zoom: nothing but this
// renderer mutes a page, so there is nothing to hear back — and its own channel
// rather than a field on the wire-frozen state payload, for the reason favicons
// got one.
export const PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL =
  "patcher-desktop:browser:set-muted";
// What the shell knows about the page's connection that the renderer cannot see
// in the URL: whether it is riding a certificate a human waved through. Its own
// channel rather than a field on the wire-frozen state payload, for the reason
// favicons got one.
export const PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL =
  "patcher-desktop:browser:page-security";
// The app is drawing over the page area, so the page has to become a bitmap the
// app can draw on. Its own channel rather than a flag on `set-visible`: that
// one is the renderer's layout intent, while this one is a freeze the shell has
// to sequence (capture, then hide) and undo in the right order.
export const PATCHER_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL =
  "patcher-desktop:browser:set-overlay";
// The user asked for the page to fill the window. Its own channel rather than a
// flag on `set-bounds`: bounds are the renderer's measured layout, pushed on
// every resize, while this is a mode the shell holds until it is told otherwise.
export const PATCHER_DESKTOP_BROWSER_SET_FULLSCREEN_CHANNEL =
  "patcher-desktop:browser:set-fullscreen";
// "Search for <selection>" from the page's context menu. The shell has the
// selection; only the renderer knows which search engine the omnibox uses, so
// the query travels rather than a URL.
export const PATCHER_DESKTOP_BROWSER_SEARCH_SELECTION_CHANNEL =
  "patcher-desktop:browser:search-selection";
// Plugin context-menu entries: the declared list going down, a click coming
// back up. Two channels because they run in opposite directions and at
// completely different rates — the list changes when plugins load, the click
// happens when a user picks one.
export const PATCHER_DESKTOP_BROWSER_SET_CONTEXT_MENU_ITEMS_CHANNEL =
  "patcher-desktop:browser:set-context-menu-items";
/**
 * The page styles this window's plugins declared, pushed whole. A new channel
 * rather than a field on an existing request: browser IPC schemas are
 * wire-frozen, and a renderer and a shell from different builds meet with no
 * handshake — see bb-migration.md, Invariant 2.
 */
export const PATCHER_DESKTOP_BROWSER_SET_PAGE_STYLES_CHANNEL =
  "patcher-desktop:browser:set-page-styles";
/**
 * The page scripts this window's plugins declared, pushed whole. A new channel
 * for the same wire-frozen reason as the styles above.
 */
export const PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL =
  "patcher-desktop:browser:set-page-scripts";
/**
 * A page script asking its own plugin something, and the answer coming back.
 *
 * Two channels rather than an invoke, because the request starts in a *third*
 * process: a browsed page asks the shell, the shell asks this window's renderer
 * (the only one that can authenticate to the Patcher server), and the answer walks
 * the same path back. A promise handed to `ipcMain.handle` could not be settled
 * by a message from somewhere else.
 */
export const PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL =
  "patcher-desktop:browser:page-script-call";
export const PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL =
  "patcher-desktop:browser:page-script-result";

export const PATCHER_DESKTOP_BROWSER_CONTEXT_MENU_INVOKE_CHANNEL =
  "patcher-desktop:browser:context-menu-invoke";
// Find in page: the command going down, the running count coming back up. Two
// channels rather than an invoke pair because one query answers many times —
// Chromium reports the count while it is still scanning — and a request/response
// shape could carry only the first of those answers or only the last.
export const PATCHER_DESKTOP_BROWSER_FIND_CHANNEL =
  "patcher-desktop:browser:find";
export const PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL =
  "patcher-desktop:browser:find-result";
// The browser channels that answer. Reads are request/response, so these are
// `invoke`/`handle` pairs rather than `send`; each is a new channel behind an
// optional preload method for the same reason favicons were (invariant 2 in
// docs/architecture/bb-migration.md).
export const PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL =
  "patcher-desktop:browser:read-page";
// Named `snapshot-tree` because `PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL` above is
// already taken by the resize bitmap — different sense of the word, and the two
// must not be confused at a call site.
export const PATCHER_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL =
  "patcher-desktop:browser:snapshot-tree";
// Dialogs, once the shell owns them: a main -> renderer push carrying the open
// dialog (or null when it closes), and an invoke channel to answer it.
export const PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL =
  "patcher-desktop:browser:dialog";
export const PATCHER_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL =
  "patcher-desktop:browser:dialog-respond";
// Chromium's own DevTools, hosted in a view the shell owns: the open/close and
// placement going down, the state coming back up. The push is not an echo —
// "Inspect" from the page menu opens them, and their own toolbar closes them,
// neither of which the renderer asked for.
export const PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_CHANNEL =
  "patcher-desktop:browser:set-dev-tools";
export const PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL =
  "patcher-desktop:browser:dev-tools-state";
// A third channel rather than a field on the first: whether the panel is on
// screen is not whether the tools are open, and the browser request schemas are
// wire-frozen (see docs/architecture/bb-migration.md, invariant 2).
export const PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL =
  "patcher-desktop:browser:set-dev-tools-visible";
// Real popups: the tabs that may have them going down, the popup the shell
// created (or that closed itself) coming back up. Two channels because they run
// in opposite directions and at completely different rates — the declaration
// changes when tabs open and close, the popup happens when a page calls
// `window.open()`.
export const PATCHER_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL =
  "patcher-desktop:browser:set-popup-tabs";
export const PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL =
  "patcher-desktop:browser:popup";
// The questions the network asks and only a human can answer: an authentication
// challenge, an untrusted certificate, a request for a client certificate. Their
// own channels rather than the dialog's, because that payload is wire-frozen and
// because these come from the network stack rather than from the page's script —
// a shell that has one has no reason to have the other.
export const PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL =
  "patcher-desktop:browser:page-prompt";
export const PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_RESPOND_CHANNEL =
  "patcher-desktop:browser:page-prompt-respond";
// Acting on the page. One channel for every verb, because they share the whole
// preamble (resolve a ref, check the snapshot generation, wait for the element
// to be actionable) and a channel per verb would freeze nine copies of it.
export const PATCHER_DESKTOP_BROWSER_INTERACT_CHANNEL =
  "patcher-desktop:browser:interact";
// Looking at the page without touching it: screenshot, PDF, console log,
// network log. One channel for the same reason `interact` is one, and the only
// automation channel that never attaches the browser debugger.
export const PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL =
  "patcher-desktop:browser:observe";
// Cookies and web storage, read and written. Kept off the observe channel even
// though it attaches no debugger either: what crosses this one is the user's
// logins rather than what a page rendered, and that is worth being able to see
// in a stack trace and in a log without decoding a payload first.
export const PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL =
  "patcher-desktop:browser:storage";
// Driving a tab past the paths that make the rest of this safe: the caller's own
// JavaScript in the page, input at raw coordinates, a mocked network. Its own
// channel because what these have in common is how much they hand over, which is
// also the line per-plugin permissions would one day be drawn along.
export const PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL =
  "patcher-desktop:browser:control";
// The accessibility snapshot of one part of a page. Its own channel because the
// unscoped snapshot's request is strict and frozen: a `selector` added to it
// would be refused by every shell that predates this, and refused as "no view",
// which is advice about the wrong problem.
export const PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL =
  "patcher-desktop:browser:snapshot-in";
// A picture of the whole document. Its own channel because the observe request
// carries a frozen union: a `fullPage` flag added to its screenshot member would
// be silently dropped by an older shell, which would answer with a viewport
// picture and call it a success. It is also the one capture that attaches the
// debugger, which is the property the observe channel exists to guarantee.
export const PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL =
  "patcher-desktop:browser:capture-full-page";
// Filming a tab. Its own channel because it is the only automation command whose
// answer is an artifact rather than a fact about the page — megabytes of frames,
// bounded by the recording's own caps rather than by a single result's.
export const PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL =
  "patcher-desktop:browser:record";

// --- Links the OS hands us, because Patcher is the user's browser ---
//
// A pull rather than a push, which is the whole shape: `open-url` fires before
// `whenReady` when the click is what launched Patcher, so there is no renderer to
// push to. Main queues, the surface drains the queue when it mounts, and the
// pending channel is a nudge for the case where a window was already open.
// Draining once is what keeps a cold start from opening the same link twice.
export const PATCHER_DESKTOP_BROWSER_TAKE_EXTERNAL_URLS_CHANNEL =
  "patcher-desktop:browser:take-external-urls";
export const PATCHER_DESKTOP_BROWSER_EXTERNAL_URLS_PENDING_CHANNEL =
  "patcher-desktop:browser:external-urls-pending";

// --- Channels a browsed page's own preload uses ---
//
// These two are the only ones reachable from the preload the shell installs in
// the browsing session, and neither is on `PatcherDesktopBrowserApi`: the Patcher app has
// no use for them, and a browsed renderer must not be able to reach anything
// else. Both are answered from the sender frame's URL as the shell resolved it,
// never from anything the payload claims about where it is.
/**
 * Answered synchronously, at document start, with the scripts that claim this
 * frame's address. Synchronous because the answer decides what runs before the
 * page's own first script, and there is no later moment to be early in.
 */
export const PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL =
  "patcher-desktop:page:script-bootstrap";
/** One `patcher.rpc` call from a page script, awaiting its plugin's answer. */
export const PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL =
  "patcher-desktop:page:script-rpc";
