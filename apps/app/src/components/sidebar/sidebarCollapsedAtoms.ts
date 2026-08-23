import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const COLLAPSED_PROJECTS_STORAGE_KEY = "patcher.sidebar.collapsedProjects";
const COLLAPSED_THREADS_STORAGE_KEY = "patcher.sidebar.collapsedThreads";
const COLLAPSED_ENVIRONMENTS_STORAGE_KEY =
  "patcher.sidebar.collapsedEnvironments";
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY =
  "patcher.sidebar.collapsedSections";
const SIDEBAR_SECTION_ORDER_STORAGE_KEY = "patcher.sidebar.sectionOrder";
const SIDEBAR_MANUAL_SECTION_ORDER_STORAGE_KEY =
  "patcher.sidebar.manualSectionOrder";
const SIDEBAR_MACHINE_SECTION_ORDER_STORAGE_KEY =
  "patcher.sidebar.machineSectionOrder";
export const SIDEBAR_ORGANIZATION_MODE_STORAGE_KEY =
  "patcher.sidebar.organizationMode";
const CHRONOLOGICAL_SORT_STORAGE_KEY = "patcher.sidebar.chronologicalSort";
const COLLAPSED_THREAD_SECTIONS_STORAGE_KEY =
  "patcher.sidebar.collapsedThreadSections";
const COLLAPSED_MACHINES_STORAGE_KEY = "patcher.sidebar.collapsedMachines";

export type SidebarSectionId =
  | "pinned"
  | "threads"
  | `project:${string}`
  | `section:${string}`
  | `machine:${string}`;
export type CollapsibleSidebarSectionId = "pinned" | "threads";

// "project" keeps the per-project grouping; "chronological" is the persisted
// value for the cross-project Sections view that replaced the old None view;
// "machine" groups threads by the host their environment runs on.
export type SidebarOrganizationMode = "project" | "chronological" | "machine";
// Controls thread ordering in both grouped and ungrouped sidebar views. Time
// sorts show newest first and alphabetical sorts A→Z. "none" is a legacy value
// that the runtime normalizes back to "updated".
export type SidebarChronologicalSort = "updated" | "created" | "alpha" | "none";

export const DEFAULT_SIDEBAR_SECTION_ORDER: readonly string[] = [
  "pinned",
  "projects",
  "threads",
];

// The folder-era keys these atoms used to adopt (`bb.sidebar.folderSectionOrder`
// and `bb.sidebar.collapsedFolders`) are gone rather than renamed, because the
// folders → sections migration they carried is older than this rename and its
// window has long closed.
//
// The reason first recorded here was wrong and is worth stating so nobody
// rebuilds on it: "the rename moved the prod origin, so no browser reaching this
// build has them". That holds only for the loopback default. An install reached
// over a stable origin — Tailscale Serve, a fixed proxy, the shell pointed at a
// custom URL — kept its origin and every `bb.*` key with it, which is why
// `lib/legacy-storage-adoption.ts` now renames them at boot instead.

export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_PROJECTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedThreadIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREADS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedEnvironmentIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_ENVIRONMENTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedSidebarSectionIdsAtom = atomWithStorage<
  CollapsibleSidebarSectionId[]
>(
  COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY,
  [],
  createJsonLocalStorage<CollapsibleSidebarSectionId[]>(),
  { getOnInit: true },
);

export const sidebarSectionOrderAtom = atomWithStorage<string[]>(
  SIDEBAR_SECTION_ORDER_STORAGE_KEY,
  [...DEFAULT_SIDEBAR_SECTION_ORDER],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const sidebarManualSectionOrderAtom = atomWithStorage<string[]>(
  SIDEBAR_MANUAL_SECTION_ORDER_STORAGE_KEY,
  ["pinned", "sections", "threads"],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const sidebarMachineSectionOrderAtom = atomWithStorage<string[]>(
  SIDEBAR_MACHINE_SECTION_ORDER_STORAGE_KEY,
  ["pinned", "machines", "threads"],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const sidebarOrganizationModeAtom =
  atomWithStorage<SidebarOrganizationMode>(
    SIDEBAR_ORGANIZATION_MODE_STORAGE_KEY,
    "project",
    createJsonLocalStorage<SidebarOrganizationMode>(),
    { getOnInit: true },
  );

export const sidebarChronologicalSortAtom =
  atomWithStorage<SidebarChronologicalSort>(
    CHRONOLOGICAL_SORT_STORAGE_KEY,
    "updated",
    createJsonLocalStorage<SidebarChronologicalSort>(),
    { getOnInit: true },
  );

// Collapsed section keys (see buildSectionKey in sectionKeys.ts). A plain string[],
// matching collapsedThreadIds / collapsedProjectIds.
export const sidebarCollapsedThreadSectionsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREAD_SECTIONS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

// Collapsed machine-mode group keys (host ids plus the no-machine sentinel;
// see machineThreadGroups.ts).
export const sidebarCollapsedMachinesAtom = atomWithStorage<string[]>(
  COLLAPSED_MACHINES_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
