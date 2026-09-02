export {
  getPersonalWorkspaceRoot,
  openWorkspace,
  provisionWorkspace,
  validatePersonalWorkspaceTargetPath,
} from "./provision.js";
export type {
  EnvSetupScriptApproval,
  EnvSetupScriptApprovalRequest,
} from "./provisioning.js";
// The definition of a workspace-write sandbox's boundary: what stays writable
// so git works, and what is refused because git executes it. Exported because
// the sandbox that enforces them lives in the daemon, and a test of that
// enforcement has to use these lists rather than a copy of them.
export {
  resolveAdditionalWorkspaceWriteRoots,
  resolveProtectedRepositoryPaths,
} from "./workspace-write-roots.js";
export type {
  HostWorkspace,
  PersonalWorkspaceOpts,
  ProvisionWorkspaceArgs,
  UnmanagedCheckoutOpts,
  UnmanagedWorkspaceOpts,
  ManagedWorkspaceBaseOpts,
  ManagedWorktreeOpts,
  ReconnectManagedWorktreeOpts,
} from "./provision.js";

export type {
  CommitOptions,
  CommitResult,
  DiffOptions,
  DiffResult,
  FetchOptions,
  PullRequestActionOptions,
  SquashMergeOptions,
  SquashMergeResult,
  StatusOptions,
} from "./workspace.js";

export {
  WorkspaceError,
  detectGitRepo,
  fetchRemoteBranches,
  getCheckoutRef,
  getCurrentBranch,
  getWorkspaceGitOperation,
  getGitCommonDir,
  gitBlobSize,
  hardenedGitChildProcessEnv,
  hasUncommittedChanges,
  listBranches,
  listRemoteBranches,
  readDefaultBranch,
  readDefaultBranchRefs,
  readGitBlob,
  runGit,
} from "./git.js";
export type {
  DefaultBranchRefs,
  FetchRemoteBranchesResult,
  ReadGitBlobResult,
} from "./git.js";

export {
  getPullRequestForCurrentBranch,
  parseGitHostPullRequest,
  type GitHostPullRequestLookup,
} from "./git-host.js";
