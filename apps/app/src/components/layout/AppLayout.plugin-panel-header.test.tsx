// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";

const viewportState = vi.hoisted(() => ({ compact: false }));
// Desktop-only behaviour is gated on this; flipping it is how a test asks for
// the shell that hosts the browser surface and the agent side panel.
const desktopState = vi.hoisted(() => ({ browserAvailable: false }));

vi.mock("@patcher/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewportState.compact,
  CompactViewportOverrideProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/sidebar/AppSidebar", () => ({
  AppSidebar: () => <aside data-testid="app-sidebar" />,
}));

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => true,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      experiments: {
        claudeCodeMockCliTraffic: false,
        editMessages: false,
        newOnboarding: false,
        toolsHub: true,
      },
    },
  }),
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({
    // No plugin claims the window's leading edge in these tests, so the panel
    // there renders nothing — which is also its default everywhere.
    leadingPanels: [],
    navPanels: [
      {
        pluginId: "helm-wiki",
        path: "wiki",
        title: "Helm Wiki",
        icon: "Book",
      },
    ],
  }),
}));

vi.mock("@/components/plugin/PluginPanelHeader", () => ({
  PluginPanelHeaderCenter: ({ panel }: { panel: { title: string } }) => (
    <span data-testid="plugin-panel-header-center">{panel.title}</span>
  ),
  PluginPanelHeaderActions: () => null,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => ({
  ProjectPathDialog: () => null,
}));

vi.mock("./AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  AppPageHeader: ({
    center,
    actions,
  }: {
    center?: ReactNode;
    actions?: ReactNode;
  }) => (
    <header data-testid="app-page-header">
      {center}
      {actions}
    </header>
  ),
}));

vi.mock("@/lib/iframe-drag-guard", () => ({
  IframeDragGuardOverlay: () => null,
}));

// The real surface drags in the whole Electron browser layer; what these tests
// are about is where AppLayout *puts* a route's output, so the stub only has to
// show what it was handed.
vi.mock("@/views/BrowserSurfaceView", () => ({
  default: ({ appScreen }: { appScreen?: ReactNode }) => (
    <div data-testid="browser-surface">{appScreen}</div>
  ),
}));

vi.mock("@/hooks/useBrowserSurfaceRouteSync", () => ({
  useBrowserSurfaceRouteSync: vi.fn(),
}));

vi.mock("@/lib/patcher-desktop", () => ({
  CHROME_ROW_CLASS: "",
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  MACOS_CHROME_CONTROL_AXIS_CLASS: "",
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS: "",
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS: "",
  MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS: "",
  SIDEBAR_TRIGGER_TRAILING_INSET_CLASS: "",
  SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  MACOS_WINDOW_NO_DRAG_CLASS: "",
  getPatcherDesktopInfo: () => null,
  getDesktopWindowKey: () => null,
  isDesktopBrowserAvailable: () => desktopState.browserAvailable,
  shouldReserveMacosTrafficLights: () => false,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("@/lib/favicon-color-preference", () => ({
  useFaviconBadge: vi.fn(),
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    isCreating: false,
    platform: "darwin",
    projectPathDialog: {
      onOpenChange: vi.fn(),
      target: null,
    },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
        createdAt: 1,
        updatedAt: 1,
      },
      projects: [],
    },
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  didThreadDetailBootstrapRefreshAfterMount: () => true,
  useThread: () => ({ data: undefined }),
  useThreadDetailBootstrap: () => ({ isError: false, isSuccess: true }),
  useThreadPendingInteractions: () => ({ data: undefined }),
  getLatestPendingInteraction: () => null,
}));

function renderPluginPanelRoute(): void {
  render(
    <MemoryRouter initialEntries={["/plugins/helm-wiki/wiki"]}>
      <AppLayout>
        <div>Plugin panel body</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

describe("AppLayout plugin panel header", () => {
  beforeEach(() => {
    viewportState.compact = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the shared header on compact viewports so the body clears the sidebar trigger", () => {
    viewportState.compact = true;
    renderPluginPanelRoute();

    expect(screen.getByTestId("app-page-header")).toBeTruthy();
    expect(screen.getByTestId("plugin-panel-header-center").textContent).toBe(
      "Helm Wiki",
    );
  });

  it("leaves the header to the split workspace on regular viewports", () => {
    renderPluginPanelRoute();

    expect(screen.queryByTestId("app-page-header")).toBeNull();
  });
});

// The shell's swap: an agent route's screen paints in the side panel so the
// browser can hold the main area. The two halves have to move together — a
// screen rendered in both places would mount twice, and one rendered in neither
// would leave the route blank.
describe("AppLayout agent panel routing", () => {
  function renderRoute(path: string): void {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout>
          <div>Route body</div>
        </AppLayout>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    viewportState.compact = false;
    desktopState.browserAvailable = true;
  });

  afterEach(() => {
    cleanup();
    desktopState.browserAvailable = false;
    vi.clearAllMocks();
  });

  it("paints the New thread route in the side panel, not the main area", async () => {
    renderRoute("/");

    expect(screen.getByTestId("agent-panel-sidebar-content").textContent).toBe(
      "Route body",
    );
    // The browser has the main area to itself: no route output there at all,
    // rather than an emptied box still holding flex height.
    expect((await screen.findByTestId("browser-surface")).textContent).toBe("");
    expect(screen.queryByTestId("app-layout-route-main")).toBeNull();
  });

  it("paints a thread route in the side panel too", () => {
    renderRoute("/threads/th_1");

    expect(screen.getByTestId("agent-panel-sidebar-content").textContent).toBe(
      "Route body",
    );
  });

  it("offers a way back out of the panel", () => {
    renderRoute("/threads/th_1");

    expect(
      screen.getByRole("link", { name: "Threads" }).getAttribute("href"),
    ).toBe("/browser");
  });

  // The sidebar keeps one open state for the docked panel and another for the
  // drawer it becomes on a narrow window. Opening the docked one there opens
  // nothing, which left the agent screen painting inside a closed drawer: the
  // route looked like it had done nothing at all.
  it("opens the drawer on a narrow window, not the docked panel", () => {
    viewportState.compact = true;
    renderRoute("/");

    expect(
      document
        .querySelector('[data-sidebar="panel"]')
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(screen.getByTestId("agent-panel-sidebar-content").textContent).toBe(
      "Route body",
    );
  });

  // Stage 3's half of the swap: what is left over — Settings, Extensions, a
  // plugin's panel — is a destination, and a destination takes a browser tab
  // rather than displacing the browser.
  it("paints a destination route inside the browser, as a tab", async () => {
    renderRoute("/plugins/helm-wiki/wiki");

    expect(screen.queryByTestId("agent-panel-sidebar-content")).toBeNull();
    const surface = await screen.findByTestId("browser-surface");
    const main = screen.getByTestId("app-layout-route-main");
    expect(main.textContent).toBe("Route body");
    expect(surface.contains(main)).toBe(true);
  });

  it("takes a project's compose screen to the panel, but its settings to a tab", async () => {
    renderRoute("/projects/proj_1");
    expect(screen.getByTestId("agent-panel-sidebar-content").textContent).toBe(
      "Route body",
    );

    cleanup();
    renderRoute("/projects/proj_1/settings");
    expect(screen.queryByTestId("agent-panel-sidebar-content")).toBeNull();
    expect(
      (await screen.findByTestId("app-layout-route-main")).textContent,
    ).toBe("Route body");
  });

  // Without a desktop shell there is no browser to hand the main area to, so
  // moving these screens out of it would leave the web build with an empty one.
  it("keeps agent routes in the main area on the web build", () => {
    desktopState.browserAvailable = false;
    renderRoute("/");

    expect(screen.queryByTestId("agent-panel-sidebar-content")).toBeNull();
    expect(screen.getByTestId("app-layout-route-main").textContent).toBe(
      "Route body",
    );
  });
});
