import type { PatcherSdkContext, PatcherSdkTransport } from "./transport.js";
import {
  createBrowserHistoryArea,
  type BrowserHistoryArea,
} from "./areas/browser-history.js";
import {
  createEnvironmentsArea,
  type EnvironmentsArea,
} from "./areas/environments.js";
import { createFilesArea, type FilesArea } from "./areas/files.js";
import { createGuideArea, type GuideArea } from "./areas/guide.js";
import { createHostsArea, type HostsArea } from "./areas/hosts.js";
import { createProjectsArea, type ProjectsArea } from "./areas/projects.js";
import { createProvidersArea, type ProvidersArea } from "./areas/providers.js";
import { createPluginsArea, type PluginsArea } from "./areas/plugins.js";
import { createPatcherRealtimeClient } from "./realtime-client.js";
import type { PatcherRealtime } from "./realtime-types.js";
import { createStatusArea, type StatusArea } from "./areas/status.js";
import { createSkillsArea, type SkillsArea } from "./areas/skills.js";
import { createThemeArea, type ThemeArea } from "./areas/theme.js";
import { createSystemArea, type SystemArea } from "./areas/system.js";
import { createTerminalsArea, type TerminalsArea } from "./areas/terminals.js";
import { createThreadsArea, type ThreadsArea } from "./areas/threads.js";
import {
  createThreadSectionsArea,
  type ThreadSectionsArea,
} from "./areas/thread-sections.js";

export type * from "./public-types.js";

export interface CreatePatcherSdkArgs {
  context?: PatcherSdkContext;
  transport: PatcherSdkTransport;
}

export interface PatcherSdk extends PatcherRealtime {
  browserHistory: BrowserHistoryArea;
  environments: EnvironmentsArea;
  files: FilesArea;
  guide: GuideArea;
  hosts: HostsArea;
  projects: ProjectsArea;
  plugins: PluginsArea;
  providers: ProvidersArea;
  skills: SkillsArea;
  status: StatusArea;
  system: SystemArea;
  terminals: TerminalsArea;
  theme: ThemeArea;
  threadSections: ThreadSectionsArea;
  threads: ThreadsArea;
}

export function createPatcherSdk(args: CreatePatcherSdkArgs): PatcherSdk {
  const context = args.context ?? {};
  const sdkContext = { transport: args.transport, context };
  const realtime = createPatcherRealtimeClient({
    transport: args.transport,
  });
  return {
    browserHistory: createBrowserHistoryArea(sdkContext),
    environments: createEnvironmentsArea(sdkContext),
    files: createFilesArea(sdkContext),
    guide: createGuideArea(),
    hosts: createHostsArea(sdkContext),
    subscribe(args) {
      return realtime.subscribe(args);
    },
    projects: createProjectsArea(sdkContext),
    plugins: createPluginsArea(sdkContext),
    providers: createProvidersArea(sdkContext),
    skills: createSkillsArea(sdkContext),
    status: createStatusArea(sdkContext),
    system: createSystemArea(sdkContext),
    terminals: createTerminalsArea(sdkContext),
    theme: createThemeArea(sdkContext),
    threadSections: createThreadSectionsArea(sdkContext),
    threads: createThreadsArea(sdkContext),
  };
}
