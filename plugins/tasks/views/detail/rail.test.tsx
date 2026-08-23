// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@patcher/plugin-sdk/testing/app";

// jsdom lacks matchMedia; the vendored Dialog's responsive root needs it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// loadPluginApp installs the fake SDK runtime; nothing SDK-touching may be
// imported before it runs.
const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const PATCHER_PROJECT_ID = "proj_pa0000000000000000000001";

function projectRow(linkedPatcherProjectId: string | null) {
  return {
    id: PROJECT_ID,
    name: "Tasks Plugin",
    prefix: "TSK",
    nextTaskNumber: 6,
    color: "blue",
    folderId: null,
    linkedPatcherProjectId,
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT5",
  projectId: PROJECT_ID,
  number: 5,
  key: "TSK-5",
  title: "Ship the rail",
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  parentTaskId: null,
  position: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
};

function detailRpc(
  linkedPatcherProjectId: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    listProjects: () => ({ projects: [projectRow(linkedPatcherProjectId)] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listTasks: (input: { parentTaskId?: string } | null) =>
      input?.parentTaskId ? { tasks: [] } : { tasks: [task] },
    getTaskByKey: () => ({ task }),
    listLabels: () => ({ labels: [] }),
    listAttachments: () => ({ attachments: [] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    listTaskPullRequests: () => ({
      pullRequests: [],
      unavailableThreadIds: [],
    }),
    listComments: () => ({ comments: [] }),
    listPatcherProjects: () => ({ patcherProjects: [] }),
    ...overrides,
  };
}

describe("dispatch target rail control", () => {
  it("links a discovered patcher project", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-5" },
      {
        rpc: detailRpc(null, {
          listPatcherProjects: () => ({
            patcherProjects: [
              { id: PATCHER_PROJECT_ID, name: "Patcher monorepo" },
            ],
          }),
          updateProject: (input: Record<string, unknown>) => {
            updateCalls.push(input);
            return {
              project: {
                ...projectRow(input.linkedPatcherProjectId as string | null),
              },
            };
          },
        }),
      },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Edit dispatch target" }),
    );
    fireEvent.click(await slot.findByLabelText("Linked Patcher project"));
    fireEvent.click(
      await slot.findByRole("option", { name: "Patcher monorepo" }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      projectId: PROJECT_ID,
      linkedPatcherProjectId: PATCHER_PROJECT_ID,
    });
  });

  it("shows the linked Patcher project's name and unlinks it", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-5" },
      {
        rpc: detailRpc(PATCHER_PROJECT_ID, {
          listPatcherProjects: () => ({
            patcherProjects: [
              { id: PATCHER_PROJECT_ID, name: "Patcher monorepo" },
            ],
          }),
          updateProject: (input: Record<string, unknown>) => {
            updateCalls.push(input);
            return {
              project: {
                ...projectRow(input.linkedPatcherProjectId as string | null),
              },
            };
          },
        }),
      },
    );
    const trigger = await slot.findByRole("button", {
      name: "Edit dispatch target",
    });
    await slot.findByText("Patcher monorepo");

    fireEvent.click(trigger);
    fireEvent.click(await slot.findByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      projectId: PROJECT_ID,
      linkedPatcherProjectId: null,
    });
  });
});
