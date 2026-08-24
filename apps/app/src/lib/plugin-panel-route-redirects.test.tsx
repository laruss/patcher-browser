// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { PluginContext } from "@/components/plugin/plugin-context";
import { usePatcherNavigate } from "./plugin-sdk-hooks";
import {
  AUTOMATIONS_PLUGIN_ID,
  AUTOMATIONS_PLUGIN_PANEL_PATH,
  getPluginPanelRoutePath,
  getAutomationDetailRoutePath,
  getAutomationEditRoutePath,
  getAutomationsRoutePath,
} from "./route-paths";

const AUTOMATION_ROUTE = {
  projectId: "proj_standard",
  automationId: "auto_standard",
} as const;

function PluginNavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const pluginNavigate = usePatcherNavigate();
  const detailPath = getAutomationDetailRoutePath(AUTOMATION_ROUTE);
  const editSubPath = `${AUTOMATION_ROUTE.projectId}/${AUTOMATION_ROUTE.automationId}/edit`;
  const detailSubPath = `${AUTOMATION_ROUTE.projectId}/${AUTOMATION_ROUTE.automationId}`;

  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <button type="button" onClick={() => navigate(detailPath)}>
        Open detail
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toPluginPanel(AUTOMATIONS_PLUGIN_PANEL_PATH, {
            subPath: editSubPath,
          })
        }
      >
        Edit from detail
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toPluginPanel(AUTOMATIONS_PLUGIN_PANEL_PATH, {
            subPath: editSubPath,
          })
        }
      >
        Open direct edit
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toCompose({
            initialPrompt: "Edit this automation",
          })
        }
      >
        Redirect edit to compose
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toPluginPanel(AUTOMATIONS_PLUGIN_PANEL_PATH, {
            subPath: detailSubPath,
            replace: true,
          })
        }
      >
        Exit edit
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Native back
      </button>
    </div>
  );
}

function RemountablePluginNavigationHarness() {
  const [mountKey, setMountKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setMountKey((value) => value + 1)}>
        Remount plugin
      </button>
      <PluginContext.Provider value={AUTOMATIONS_PLUGIN_ID}>
        <PluginNavigationHarness key={mountKey} />
      </PluginContext.Provider>
    </>
  );
}

async function clickAndExpectPath(label: string, path: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => {
    expect(screen.getByTestId("path").textContent).toBe(path);
  });
}

describe("plugin panel route redirects", () => {
  afterEach(cleanup);

  it("redirects remounted automation edit routes without duplicate history entries", async () => {
    render(
      <MemoryRouter initialEntries={[getAutomationsRoutePath()]}>
        <RemountablePluginNavigationHarness />
      </MemoryRouter>,
    );

    const detailPath = getAutomationDetailRoutePath(AUTOMATION_ROUTE);
    const editPath = getAutomationEditRoutePath(AUTOMATION_ROUTE);

    await clickAndExpectPath("Open detail", detailPath);
    await clickAndExpectPath("Edit from detail", editPath);
    await clickAndExpectPath("Remount plugin", editPath);
    await clickAndExpectPath("Redirect edit to compose", "/");
    await clickAndExpectPath("Native back", detailPath);
    await clickAndExpectPath("Native back", getAutomationsRoutePath());

    await clickAndExpectPath("Open direct edit", editPath);
    await clickAndExpectPath("Remount plugin", editPath);
    await clickAndExpectPath("Redirect edit to compose", "/");
    await clickAndExpectPath("Native back", getAutomationsRoutePath());
  });

  it("keeps Automations on its plugin panel route", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RemountablePluginNavigationHarness />
      </MemoryRouter>,
    );

    const editSubPath = `${AUTOMATION_ROUTE.projectId}/${AUTOMATION_ROUTE.automationId}/edit`;
    await clickAndExpectPath(
      "Open direct edit",
      getPluginPanelRoutePath({
        pluginId: AUTOMATIONS_PLUGIN_ID,
        path: AUTOMATIONS_PLUGIN_PANEL_PATH,
        subPath: editSubPath,
      }),
    );
  });
});
