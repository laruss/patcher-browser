import type { HostDaemonSkillTree } from "@patcher/host-daemon-contract";

export type FetchSkillTree = (treeHash: string) => Promise<HostDaemonSkillTree>;
