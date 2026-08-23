# Agent Browser — Project Plan

## 1. Project Overview

This project is an **agent-first, Chromium-based desktop browser** built from a fork of `laruss/patcher-browser`.

The main idea is not simply to add an AI sidebar to an existing browser.

The browser itself should be a **programmable and agent-modifiable environment**.

A user should be able to describe a desired browser feature in natural language, for example:

> Add agent suggestions to the address bar alongside normal search suggestions.

or:

> Add a sidebar panel that groups tabs by project.

or:

> When I select text on a page, add an action that sends it to Claude and asks for an explanation.

A coding agent should then be able to implement this feature as a browser plugin, install or reload it, and make the functionality available without requiring manual modification of the browser core.

The long-term product concept is:

> **A browser that can extend and modify itself through coding agents.**

---

# 2. Base Project

The initial implementation should be created as a fork of:

`laruss/patcher-browser`

Patcher already provides several pieces of infrastructure that are useful for this project:

- coding-agent orchestration;
- agent runtime;
- support for external coding agents;
- server/runtime architecture;
- daemon/background processes;
- persistent state;
- SQLite infrastructure;
- CLI and SDK concepts;
- plugin infrastructure;
- agent-oriented workflows;
- desktop Electron application.

The project should **reuse these lower-level systems where practical**, rather than rewriting the agent platform from scratch.

However, the existing Patcher application UI should not be treated as the final product.

The desktop and application layers should gradually be transformed into a browser-first product.

Conceptually:

```text
Patcher

Agent workspace
      ↓
Agent Browser
```

The fork will eventually diverge significantly from Patcher at the product/UI level.

---

# 3. Core Product Principle

The system should distinguish between two kinds of modification.

## Level 1 — Browser Plugins

This should handle the majority of user-requested functionality.

Examples:

- add an omnibox search provider;
- add an action to the tab context menu;
- create a sidebar panel;
- add a toolbar button;
- add a command or keyboard shortcut;
- inject functionality into webpages;
- add a new-tab widget;
- create a download handler;
- provide additional context to agents;
- expose additional tools to agents.

These modifications should **not require changes to the browser core**.

The coding agent should create or modify a plugin using the Browser Plugin SDK.

Example:

```text
User
  ↓

"Add Claude suggestions to the address bar."

  ↓

Coding Agent
  ↓

plugins/claude-omnibox/
  plugin.json
  index.ts
  omnibox.ts

  ↓

Plugin reload

  ↓

Feature immediately becomes available
```

## Level 2 — Browser Core Modifications

Some requests will require changing the browser itself.

Examples:

- replace horizontal tabs with vertical tabs;
- completely change the omnibox UI;
- change browser window layout;
- implement a new type of browser surface;
- introduce a new plugin contribution point;
- change how tabs or sessions are internally managed.

In those cases the coding agent may modify the browser source itself.

Core modification should be possible, but it should **not be the default extension mechanism**.

A major architectural goal is to make the Plugin API powerful enough that most customization can happen without touching core code.

---

# 4. High-Level Architecture

The initial architecture should use:

- **Electron** as the desktop and Chromium/browser layer;
- **React/TypeScript** for browser UI;
- **Patcher infrastructure** for agents, persistence and orchestration;
- **Bun gradually introduced as a separate runtime for plugins, agents and background services**;
- RPC between privileged Electron code and untrusted/extensible runtime code.

Target architecture:

```text
┌──────────────────────────────────────────────────────┐
│                     Browser UI                       │
│                                                      │
│ Tabs                                                 │
│ Omnibox                                              │
│ Toolbar                                              │
│ Sidebar                                              │
│ New Tab                                              │
│ Settings                                             │
│ Agent UI                                             │
│                                                      │
│ React + TypeScript                                   │
└───────────────────────┬──────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│                  Electron Browser Core               │
│                                                      │
│ BrowserWindow                                        │
│ WebContentsView                                      │
│ Chromium                                             │
│ Sessions                                             │
│ Cookies                                              │
│ Navigation                                           │
│ Downloads                                            │
│ Permissions                                          │
│ DevTools                                             │
│ OS integration                                       │
└───────────────────────┬──────────────────────────────┘
                        │
                    Browser RPC
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│                     Runtime Host                     │
│                                                      │
│ Agent Runtime                                        │
│ Plugin Runtime                                       │
│ MCP                                                  │
│ Background Services                                  │
│ Search Providers                                     │
│ Plugin Permissions                                   │
│                                                      │
│ Initially Node where inherited from Patcher               │
│ Gradually move suitable parts to Bun                 │
└───────────────┬──────────────┬──────────────┬─────────┘
                │              │              │
                ▼              ▼              ▼

             Plugin A       Plugin B       Plugin C
```

---

# 5. Electron Strategy

Electron should remain the browser foundation.

Do **not** replace Electron with experimental projects such as `bun-electron`.

Electron is responsible for:

- Chromium rendering;
- browser windows;
- browser tabs/web contents;
- session handling;
- cookies;
- network/browser lifecycle;
- permissions;
- downloads;
- native OS functionality;
- DevTools;
- window management.

The browser should use Chromium web contents managed by Electron rather than trying to implement web rendering itself.

Initially, each browser tab should conceptually correspond to a managed Chromium `WebContentsView` or equivalent Electron web-content abstraction.

Example:

```text
BrowserWindow
│
├── React browser chrome
│   ├── TabBar
│   ├── Omnibox
│   ├── Toolbar
│   └── Sidebar
│
└── WebContentsView manager
    ├── Tab 1
    ├── Tab 2
    ├── Tab 3
    └── ...
```

The React UI and actual webpage contents must be treated as separate layers.

---

# 6. Bun Strategy

Do not migrate the entire Patcher fork to Bun at the beginning.

The initial goal is to minimize unnecessary architectural changes while transforming Patcher into a browser.

Recommended migration order:

## Stage 1

Keep the existing Patcher runtime stack.

Focus entirely on getting the browser architecture working.

```text
Electron
Node
existing Patcher infrastructure
existing package manager
```

## Stage 2

Introduce a separate Plugin Host.

Run generated/custom browser plugins outside the Electron main process.

Bun is a strong candidate for this process.

```text
Electron
    │
    │ RPC
    ▼
Bun Plugin Host
    │
    ├── Plugin A
    ├── Plugin B
    └── Plugin C
```

## Stage 3

Move suitable background systems to Bun.

Candidates:

- plugin execution;
- MCP services;
- lightweight local APIs;
- search providers;
- background jobs;
- agent-supporting services.

## Stage 4

Evaluate moving additional Patcher agent infrastructure to Bun.

Only migrate components when compatibility has been verified.

Do not perform a project-wide Node → Bun migration purely for technological consistency.

Electron and Bun have different responsibilities.

The desired architecture is:

```text
Electron = Browser + Chromium + OS

Bun = Programmability + Plugins + Agents + Services
```

---

# 7. Browser Plugin Platform

The Browser Plugin Platform is one of the most important parts of the project.

Plugins should interact with the browser through a stable SDK instead of importing Electron APIs directly.

A plugin should look conceptually like:

```ts
import { definePlugin } from "@browser/sdk";

export default definePlugin({
  id: "example-plugin",
  name: "Example Plugin",

  activate(browser) {
    // register browser functionality
  },
});
```

Plugins should be able to register functionality using contribution points.

Initial desired contribution points:

```text
browser.omnibox.providers
browser.omnibox.actions

browser.tabs.actions
browser.tabs.decorators

browser.toolbar.items

browser.sidebar.panels

browser.contextMenu.items

browser.page.contentScripts

browser.newTab.widgets

browser.commands

browser.shortcuts

browser.downloads.handlers

browser.navigation.handlers

browser.agent.tools

browser.agent.contextProviders
```

The exact API does not need to be finalized immediately.

The architecture should make it easy to add new contribution points later.

---

# 8. Example Plugin API

A future omnibox provider might look approximately like:

```ts
browser.omnibox.registerProvider({
  id: "claude",

  async suggest(query) {
    return [
      {
        title: `Ask Claude: ${query}`,
        type: "agent-action",

        action: {
          agent: "claude",
          prompt: query,
        },
      },
    ];
  },
});
```

A sidebar plugin:

```ts
browser.sidebar.registerPanel({
  id: "research",
  title: "Research",
  icon: "search",
  component: ResearchPanel,
});
```

A context-menu plugin:

```ts
browser.contextMenu.registerItem({
  id: "explain-selection",

  when: {
    selection: true,
  },

  title: "Explain with Claude",

  async execute(context) {
    await browser.agent.run({
      agent: "claude",
      prompt: `Explain this text:\n\n${context.selection}`,
    });
  },
});
```

These are conceptual examples only.

Do not lock the implementation to these exact interfaces without first designing the SDK boundaries.

---

# 9. Plugin Security Model

Generated plugins must **not execute directly inside the Electron main process**.

This is particularly important because many plugins will eventually be generated automatically by coding agents.

Bad architecture:

```text
Generated plugin
      ↓
Electron main
      ↓
Full machine access
```

Preferred architecture:

```text
Generated Plugin
       │
       ▼
Plugin Host
       │
       ▼
Permission Layer
       │
       ▼
Browser RPC
       │
       ▼
Electron Browser Core
```

Plugins should declare permissions.

Example:

```json
{
  "permissions": ["tabs.read", "tabs.modify", "page.read", "omnibox.register"]
}
```

Potential permission categories:

```text
tabs.read
tabs.modify

page.read
page.inject

history.read

bookmarks.read
bookmarks.modify

downloads.read
downloads.create

cookies.read
cookies.modify

network.observe

sidebar.register

toolbar.register

omnibox.register

agent.invoke

filesystem.read
filesystem.write

shell.execute
```

Sensitive capabilities must not be implicitly available.

Especially sensitive:

```text
filesystem
shell
credentials
cookies
network interception
OS APIs
```

The permission architecture does not have to be complete in the first prototype, but plugin execution must be designed with isolation in mind from the beginning.

---

# 10. Browser Plugins vs Chrome Extensions

Treat these as two different systems.

## Browser Plugins

Our own extension mechanism.

Purpose:

- modify browser UI;
- add browser-level functionality;
- integrate agents;
- create new browser surfaces;
- extend omnibox;
- extend tab system;
- extend sidebar;
- interact with internal Browser API.

This is a first-class feature of the product.

## Chrome Extensions

Compatibility with existing Chrome extensions.

This is useful, but should **not determine the architecture of the first version**.

Full Chrome Web Store compatibility is not required for MVP.

If Electron supports a subset of extensions, expose that functionality where practical.

Additional compatibility may be implemented later.

Do not compromise the Browser Plugin API to imitate Chrome Extension APIs.

---

# 11. Omnibox Architecture

The omnibox should be designed as an extensible aggregation system rather than a simple URL input.

Conceptually:

```text
User Query
     │
     ▼
OmniboxController
     │
     ├── HistoryProvider
     ├── BookmarkProvider
     ├── SearchProvider
     ├── OpenTabsProvider
     ├── PluginProvider
     ├── AgentProvider
     └── ...
             │
             ▼
          Ranking
             │
             ▼
        Unified Results
```

Example result set:

```text
best coffee belgrade

Search    best coffee belgrade
History   Best coffee shops — Reddit
Search    best specialty coffee belgrade
Claude    Find five good options and compare them
Agent     Search reviews across several sources
Tab       Specialty Coffee Guide
```

Providers should return structured results.

The omnibox itself should not need to know how each provider obtains them.

---

# 12. First Vertical Slice

The first meaningful end-to-end demonstration should be an **extensible omnibox**.

This validates almost every important architectural decision.

## Goal

Start typing into the browser address bar and receive mixed suggestions from:

1. standard browser/search sources;
2. a Browser Plugin.

Example:

```text
best headphones

Google       best headphones
Google       best headphones 2026
Agent        Research the best headphones for me
Google       best headphones reddit
Claude       Compare current recommendations
```

## Required components

Implement:

- browser window;
- basic tabs;
- Chromium page rendering;
- navigation;
- omnibox;
- provider interface;
- built-in search provider;
- plugin manager;
- plugin registration;
- one example agent/search plugin;
- unified result ranking/rendering.

The first plugin does not need sophisticated agent intelligence.

A fake or simple provider is acceptable initially.

The purpose of the slice is proving:

```text
Plugin
  ↓
Plugin Host
  ↓
Browser API
  ↓
React Browser UI
```

works correctly.

---

# 13. Browser UI MVP

Do not attempt to reproduce Chrome completely.

The first browser UI needs only:

```text
Window
├── Tab bar
├── Navigation controls
│   ├── back
│   ├── forward
│   └── reload
├── Omnibox
├── Web content
└── Agent/sidebar toggle
```

Required browser behavior:

- create tab;
- close tab;
- switch tabs;
- navigate URL;
- perform web search;
- back;
- forward;
- reload;
- page title;
- favicon if practical;
- basic session persistence.

Everything else can follow later.

---

# 14. Agent UI

The existing Patcher application should gradually become an integrated browser agent workspace.

The browser should eventually allow something similar to:

```text
┌────────────────────────────────────────────────────────────┐
│ Tabs                                                       │
├────────────────────────────────────────────────────────────┤
│ Omnibox                                                    │
├─────────────────────────────────────────┬──────────────────┤
│                                         │ Agent            │
│                                         │                  │
│         Chromium webpage                │ Thread           │
│                                         │                  │
│                                         │ Claude / Codex   │
│                                         │                  │
│                                         │ Tasks            │
│                                         │                  │
└─────────────────────────────────────────┴──────────────────┘
```

The agent panel should eventually be capable of:

- reading browser state;
- reading selected page content when allowed;
- knowing open tabs;
- navigating browser pages;
- creating plugins;
- modifying plugins;
- modifying browser core when required;
- running tests;
- reloading plugins;
- inspecting errors.

Do not make a complex agent UX part of the earliest browser MVP.

Reuse Patcher surfaces where convenient until replacement becomes necessary.

---

# 15. Self-Modification Workflow

The eventual intended workflow is:

```text
User
 ↓
Natural language request
 ↓
Manager / Coding Agent
 ↓
Determine whether request requires:
 ├── existing settings
 ├── plugin creation/modification
 └── browser core modification
 ↓
Create implementation
 ↓
Run validation/tests
 ↓
Reload plugin or development browser
 ↓
Feature becomes available
```

Example:

```text
User:
"Add a button to the context menu that summarizes selected text."

Agent:
1. inspects Browser Plugin SDK;
2. creates plugin;
3. requests required permissions;
4. registers context-menu item;
5. connects action to agent runtime;
6. runs plugin tests;
7. installs/reloads plugin.
```

This workflow is a core product experience, not merely a development convenience.

---

# 16. Suggested Repository Direction

Do not immediately reorganize the entire Patcher repository.

First understand the existing dependency graph.

Eventually a structure similar to the following may be desirable:

```text
apps/
  browser/
    desktop/
    renderer/

  agent-ui/

packages/
  browser-core/
  browser-state/
  browser-rpc/

  browser-sdk/
  plugin-api/
  plugin-host/

  omnibox/
  tabs/
  sidebar/

  agent-runtime/
  agent-browser-tools/

plugins/
  examples/
    mixed-search/
    explain-selection/
    research-sidebar/

services/
  agent-host/
  plugin-host/
```

This is a target direction, not a required immediate migration.

Prefer incremental extraction over a large initial repository rewrite.

---

# 17. Migration Strategy from Patcher

The first development task should be **repository reconnaissance**, not deleting code.

Determine which Patcher components belong to:

### Keep

Likely:

- agent runtime;
- agent orchestration;
- persistent state where useful;
- SQLite;
- CLI infrastructure;
- SDK infrastructure;
- daemon/process management;
- coding-agent integrations;
- useful plugin infrastructure.

### Adapt

Likely:

- plugin APIs;
- agent UI;
- desktop shell;
- server APIs;
- application state.

### Replace

Likely:

- primary workspace UI;
- editor-oriented surfaces;
- project-centric navigation that does not make sense in a browser;
- desktop layout.

### Add

Required:

- browser tab manager;
- WebContentsView manager;
- browser state model;
- navigation controller;
- omnibox;
- Browser RPC;
- Browser Plugin SDK;
- Plugin Host;
- browser permissions;
- browser-agent tools.

Do not remove inherited Patcher systems until their dependencies and replacement paths are understood.

---

# 18. Implementation Phases

## Phase 0 — Repository Analysis

Before major implementation:

- map Patcher architecture;
- identify desktop entry points;
- identify server/runtime boundaries;
- identify plugin system;
- identify agent orchestration;
- identify SQLite dependencies;
- identify components strongly coupled to Patcher's existing workspace UI;
- document which packages are retained, adapted or replaced.

Deliverable:

`docs/architecture/bb-migration.md`

---

## Phase 1 — Browser Shell

Turn the Electron desktop application into a minimal browser.

Implement:

- browser window;
- Chromium web content;
- tab model;
- tab creation;
- tab switching;
- tab closing;
- navigation;
- omnibox;
- basic browser state.

Do not implement plugins yet beyond interfaces required for the next phase.

Deliverable:

A functional minimal desktop browser capable of normal browsing.

---

## Phase 2 — Browser Core API

Create internal APIs for:

- tabs;
- navigation;
- active page;
- browser state;
- omnibox;
- sidebar;
- commands.

Separate React UI from Electron implementation using explicit boundaries.

Do not allow application components to call arbitrary Electron internals.

Deliverable:

Stable initial Browser API.

---

## Phase 3 — Plugin System

Introduce:

- plugin manifests;
- plugin discovery;
- plugin enable/disable;
- plugin lifecycle;
- initial contribution points;
- Plugin SDK;
- example plugin.

Initial contribution point priority:

1. omnibox providers;
2. context menu;
3. sidebar;
4. commands;
5. agent tools.

Deliverable:

A plugin can add a visible feature without changing browser-core source.

---

## Phase 4 — Extensible Omnibox Vertical Slice

Implement mixed provider suggestions.

Providers:

- URLs/navigation;
- history if available;
- search;
- plugin provider;
- agent provider.

Deliverable:

Agent/search plugin suggestions visibly coexist with normal search results.

This is the first major proof of the product concept.

---

## Phase 5 — Agent Browser Integration

Expose browser tools to Patcher agents.

Example tools:

```text
browser.tabs.list
browser.tabs.open
browser.tabs.close
browser.tabs.activate

browser.page.getUrl
browser.page.getTitle
browser.page.getText
browser.page.getSelection

browser.navigation.open
browser.navigation.back
browser.navigation.forward
browser.navigation.reload
```

All tools must use Browser APIs.

Agents should not directly manipulate Electron internals.

Deliverable:

Existing Patcher agents can understand and operate browser state.

---

## Phase 6 — Self-Generated Plugins

Enable a coding agent to:

- inspect plugin documentation;
- create a plugin;
- validate the manifest;
- run checks;
- install it;
- reload it;
- inspect runtime errors.

Add one guided example:

> "Create a plugin that adds `Explain with Agent` when text is selected."

Deliverable:

Natural-language request → generated plugin → working browser functionality.

This is the first complete realization of the project's core concept.

---

## Phase 7 — Bun Plugin Host

Extract generated/custom plugin execution into a separate runtime.

Prefer Bun if compatibility is sufficient.

Implement:

- plugin process lifecycle;
- RPC;
- capability/permission model;
- crash isolation;
- plugin reload;
- logging.

Deliverable:

Generated plugins no longer execute inside the privileged Electron process.

---

## Phase 8 — Additional Browser Surfaces

Expand Plugin SDK to support:

- sidebar panels;
- toolbar items;
- tab actions;
- tab decorators;
- new-tab widgets;
- keyboard shortcuts;
- downloads;
- page scripts;
- agent context providers.

Prioritize based on real use cases rather than implementing every API upfront.

---

## Phase 9 — Extending the Pages Themselves

Everything through Phase 8 extends Patcher's own chrome. This phase is about the
browsed page: the work a user would otherwise reach for a Chrome extension or a
userscript to do.

> "Users can modify websites and the browser itself" — remove or alter parts of a
> site, add controls to specific sites, change behaviour per site, and put the
> result in a **browser-native** panel rather than injected DOM.

**A note on Phase 8's "page scripts".** That line was read as satisfied by the
frontend `app.contentScripts` surface, which is trusted code in _Patcher's own_ page.
Running a plugin's code in a _browsed_ page is a different thing entirely and was
never built. This phase is where it belongs.

### Stage A — CSS, and a permission that names sites (done)

`patcher.browser.registerPageStyle`, permission `pageStyle.register`, scoped by a new
manifest field `patcher.sites`. Plus `matches` on `experimental_leadingPanel`, so a
panel appears only while the active tab is on a matching site.

Taken first because it closes the largest share of the ask — "remove or alter
parts of a site" is usually one CSS rule — while running no plugin code in the
page and reading nothing back, which reduces the consent question to _which
sites_. That made it the right place to introduce the repository's first
host-scoped permission on the safest possible capability.

Deliverable: `examples/plugins/site-tweaks`, with no change to the browser core.

### Stage B — the plugin's own code in the page (done)

`patcher.browser.registerPageScript`, permission `pageScript.register`, scoped by the
same `patcher.sites` and checked by the same membership rule. The script runs in an
isolated world of the plugin's own with two names in it: `patcher.rpc` — the plugin's own
backend and nothing else — and `patcher.ready`.

The mechanism is a **session preload registered only while a page script is
declared**, not CDP. CDP would have done more (subframes, bindings), but it would
have required the browser debugger attached to every tab permanently, against a
documented invariant, and DevTools taking the target would have silently stopped
every page script. The preload exposes nothing into the page's own world, so the
standing rule that a browsed page never receives a Patcher bridge survives.

Both things Stage A's mechanism could not carry were settled by measurement rather
than assumption:

- **`document_start` timing: reached.** The preload runs when the document exists
  and the parser has produced nothing — earlier than `insertCSS` lands, and earlier
  than the page's own first script. `patcher.ready` exists because of it.
- **Subframes: still out of reach, deliberately.** A session preload does not run in
  subframes without `nodeIntegrationInSubFrames`, which is experimental and would
  change every browsed page rather than the matching ones.

The channel crosses three processes because no shorter path exists — the page can
hold no credentials and the shell holds none for the Patcher server — and the plugin is
re-checked against the frame's real address on every call, in both the shell and the
renderer.

Deliverable: `examples/plugins/site-tweaks` gained the in-page half, closing the
loop — a button in GitHub's page, a row in the plugin's own SQLite, and the note
appearing in Patcher's own panel over `patcher.realtime`. Still no change to the browser core
from the plugin's side.

Explicitly **not** in scope, and still not: loading real CRX bundles or shimming
`chrome.*`. That looks like a shortcut and is a permanent compatibility obligation
to a moving target, with a permission model that is not ours. The agent is the
translator instead — "port this userscript" is a prompt.

---

# 19. Non-Goals for Initial MVP

Do not initially attempt:

- perfect Chrome replacement;
- full Chrome Web Store compatibility;
- Chromium source fork;
- mobile support;
- browser sync infrastructure;
- account ecosystem;
- complete bookmark manager;
- sophisticated password manager — no sync, no sharing, no breach monitoring;
  the plain one is now first in [TODO.md](TODO.md), because signing in to a site
  turned out to be a hole rather than a scope boundary;
- perfect privacy architecture;
- every browser setting;
- production-ready plugin marketplace;
- fully autonomous core rewriting;
- migrating all Node code to Bun;
- rebuilding every Patcher component.

The MVP should prove one thing exceptionally well:

> **The browser can be extended through coding-agent-generated plugins.**

---

# 20. Key Technical Principles

## Keep browser core small

Prefer:

```text
stable Browser Core
        +
extensible Plugin API
```

over:

```text
agent constantly rewriting Browser Core
```

## Plugins use capabilities, not internals

Plugins should depend on:

```text
@browser/sdk
```

not:

```text
electron
internal browser components
internal database modules
```

## UI and browser engine are separate

React controls browser chrome.

Electron/Chromium controls webpage contents.

## Electron remains privileged

Only trusted core code gets direct Electron access.

## Generated code is untrusted by default

Agent-generated plugins must go through the same permission boundaries as manually installed plugins.

## Bun adoption should solve specific problems

Do not migrate technology solely for novelty or consistency.

## Browser state should be inspectable

Both humans and agents should be able to understand:

- tabs;
- active tab;
- URLs;
- plugin state;
- available capabilities;
- runtime errors.

## Agent interfaces should use the same APIs as plugins where possible

Avoid creating separate hidden browser-control systems for agents.

---

# 21. Coding-Agent Development Rules

When implementing this project:

1. Inspect existing Patcher architecture before replacing systems.
2. Prefer incremental changes over repository-wide rewrites.
3. Preserve working Patcher agent infrastructure until a replacement is proven.
4. Add explicit APIs instead of cross-package imports.
5. Keep Electron-specific code isolated.
6. Do not expose Electron main APIs directly to plugins.
7. Every new browser surface should be evaluated as a possible plugin contribution point.
8. Prefer adding capabilities to the SDK over implementing one-off integrations.
9. Build vertical slices before broad API coverage.
10. Maintain runnable development builds throughout migration.

For significant architectural changes, document the reasoning in:

```text
docs/architecture/
```

---

# 22. Testing Priorities

Early automated testing should focus primarily on boundaries.

Test:

- browser tab state;
- navigation;
- Browser RPC;
- plugin registration;
- plugin activation/deactivation;
- contribution-point registration;
- plugin crash isolation;
- omnibox provider aggregation;
- plugin permissions;
- agent-browser tools.

End-to-end tests should eventually verify scenarios such as:

```text
launch browser
→ open tab
→ enter query
→ plugin returns suggestion
→ select suggestion
→ expected action runs
```

and:

```text
install plugin
→ plugin registers context menu
→ select text
→ execute plugin action
→ agent receives selected text
```

---

# 23. First Milestone Definition

The project reaches its first meaningful milestone when all of the following work together:

- application launches as a real desktop browser;
- multiple Chromium-backed tabs work;
- navigation and omnibox work;
- existing Patcher agent infrastructure still runs;
- plugins can be loaded dynamically;
- Plugin SDK exposes at least one browser-level contribution point;
- an example plugin adds suggestions to the omnibox;
- standard search and plugin suggestions appear in the same UI;
- plugin functionality can be changed and reloaded without editing browser core.

At that point the architecture has validated the central hypothesis.

---

# 24. Second Milestone Definition

The second milestone should demonstrate the complete agent-driven workflow.

A user can request:

> Add an action that explains selected text using an agent.

The system should be able to:

```text
Natural-language request
        ↓
Coding agent
        ↓
Create Browser Plugin
        ↓
Validate
        ↓
Install
        ↓
Reload
        ↓
New browser functionality appears
```

The resulting plugin should run through the normal Plugin SDK and permission system.

No custom hardcoded integration should be required for the demo.

---

# 25. Long-Term Vision

The browser should eventually feel less like a fixed application and more like a personal software platform.

Instead of waiting for browser developers to implement a feature, the user can ask:

> Make tabs behave like this.

> Add this source to search.

> Put my Linear tasks in the omnibox.

> Add a research panel.

> Let me send selected images to this model.

> Add a command that compares the products on my open tabs.

The coding agent builds the requested capability against the Browser Plugin SDK.

Over time the user's browser becomes personalized through accumulated plugins.

The ultimate architecture is:

```text
                         User
                           │
                    Natural language
                           │
                           ▼
                     Coding Agents
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
       Browser Plugins             Browser Core
        most changes             rare deep changes
              │                         │
              └────────────┬────────────┘
                           │
                           ▼
                  Agent Browser Platform
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
       Chromium        Browser SDK       Agent Runtime
          │
          ▼
          Web
```

The core product differentiator is not simply having AI inside a browser.

It is:

> **A programmable browser where coding agents can create new browser capabilities on demand.**
