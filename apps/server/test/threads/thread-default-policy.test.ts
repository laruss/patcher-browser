import { listBuiltInAgentProviderInfos } from "@patcher/agent-providers";
import {
  PERSONAL_PROJECT_ID,
  type ProjectExecutionDefaults,
  type Thread,
} from "@patcher/domain";
import { describe, expect, it } from "vitest";
import {
  resolveCreateThreadEnvironment,
  resolveCreateThreadExecutionDefaults,
  resolveThreadDefaultPermissionMode,
  resolveThreadExecutionPermissionMode,
  resolveWorkflowsEnabledPolicy,
} from "../../src/services/threads/thread-default-policy.js";

type PolicyTestThread = Pick<
  Thread,
  "childOrigin" | "originKind" | "parentThreadId" | "projectId" | "providerId"
>;
type PolicyTestParentThread = Pick<
  Thread,
  | "archivedAt"
  | "deletedAt"
  | "environmentId"
  | "id"
  | "parentThreadId"
  | "projectId"
>;

function makeThread(
  overrides: Partial<PolicyTestThread> = {},
): PolicyTestThread {
  return {
    childOrigin: null,
    originKind: null,
    parentThreadId: null,
    projectId: "proj-1",
    providerId: "codex",
    ...overrides,
  };
}

function makeDefaults(
  overrides: Partial<ProjectExecutionDefaults> = {},
): ProjectExecutionDefaults {
  return {
    model: "gpt-5",
    permissionMode: "full",
    providerId: "codex",
    reasoningLevel: "medium",
    serviceTier: "default",
    ...overrides,
  };
}

function makeParentThread(
  overrides: Partial<PolicyTestParentThread> = {},
): PolicyTestParentThread {
  return {
    archivedAt: null,
    deletedAt: null,
    environmentId: "env-parent-1",
    id: "thr-parent-1",
    parentThreadId: null,
    projectId: "proj-1",
    ...overrides,
  };
}

describe("resolveWorkflowsEnabledPolicy", () => {
  it("enables workflows for claude-code sessions only", () => {
    expect(resolveWorkflowsEnabledPolicy("claude-code")).toBe(true);
    expect(resolveWorkflowsEnabledPolicy("codex")).toBe(false);
    expect(resolveWorkflowsEnabledPolicy("pi")).toBe(false);
    expect(resolveWorkflowsEnabledPolicy("acp-my-agent")).toBe(false);
  });
});

describe("resolveCreateThreadExecutionDefaults", () => {
  it("uses the model picker's first catalog provider without pinning a model", () => {
    const productProviderId = listBuiltInAgentProviderInfos()[0]?.id;
    expect(productProviderId).toBeDefined();

    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults: null,
      }),
    ).toEqual({
      providerId: productProviderId,
      executionDefaults: null,
    });
  });

  it("discards stored defaults when the resolved provider changes", () => {
    expect(
      resolveCreateThreadExecutionDefaults({
        requestedProviderId: "pi",
        storedDefaults: makeDefaults({
          providerId: "codex",
          model: "gpt-5.5",
        }),
      }),
    ).toEqual({
      providerId: "pi",
      executionDefaults: null,
    });
  });

  it("reuses matching stored defaults", () => {
    const storedDefaults = makeDefaults({
      model: "gpt-5.1",
      permissionMode: "accept-edits",
    });

    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults,
      }),
    ).toEqual({
      providerId: "codex",
      executionDefaults: storedDefaults,
    });
  });
});

describe("resolveCreateThreadEnvironment", () => {
  it("defaults implicit child host environments to managed worktrees", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host",
          hostId: "host-1",
          workspace: { type: "unmanaged", path: null },
        },
      }),
    ).toEqual({
      type: "host",
      hostId: "host-1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("keeps explicit same-environment reuse for child threads", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "reuse",
          environmentId: "env-1",
        },
      }),
    ).toEqual({
      type: "reuse",
      environmentId: "env-1",
    });
  });

  it("defaults personal child threads to the parent environment", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeParentThread({
          environmentId: "env-personal-parent",
          projectId: PERSONAL_PROJECT_ID,
        }),
        projectId: PERSONAL_PROJECT_ID,
        requestedEnvironment: {
          type: "host",
          workspace: { type: "personal" },
        },
      }),
    ).toEqual({
      type: "reuse",
      environmentId: "env-personal-parent",
    });
  });

  it.each([
    {
      args: {
        parentThread: null,
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
      },
      name: "requests without a parent thread",
    },
    {
      args: {
        parentThread: makeParentThread({
          deletedAt: 1,
        }),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
      },
      name: "deleted parents",
    },
    {
      args: {
        parentThread: makeParentThread({
          projectId: "proj-2",
        }),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
      },
      name: "parents from another project",
    },
    {
      args: {
        parentThread: makeParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: "/tmp/existing" },
        },
      },
      name: "explicit unmanaged paths",
    },
  ])("passes through $name", ({ args }) => {
    expect(resolveCreateThreadEnvironment(args)).toEqual(
      args.requestedEnvironment,
    );
  });
});

describe("resolveThreadDefaultPermissionMode", () => {
  it("uses the auto permission default for non-agent providers", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "custom-provider",
        }),
      }),
    ).toBe("auto");
  });

  it("uses the sandbox for Pi threads, which it could not before", () => {
    // Pi supported only Full Access, so its default was Full Access and the
    // product default could not reach it. It now runs with its bridge inside
    // the sandbox Patcher builds, so a Pi thread defaults like every other.
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "pi",
        }),
      }),
    ).toBe("auto");
  });

  it("keeps ACP threads sandboxed when the Auto default is unsupported", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "acp-my-agent",
        }),
      }),
    ).toBe("accept-edits");
  });

  it("uses auto for Codex threads", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          parentThreadId: "thr-other-project-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("auto");
  });
});

describe("resolveThreadExecutionPermissionMode", () => {
  it("honors the permission snapshot requested for a side chat", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        requestedPermissionMode: "full",
        lastExecutionPermissionMode: "full",
        projectExecutionPermissionMode: "full",
        thread: makeThread({ originKind: "fork" }),
      }),
    ).toBe("full");
  });

  it("prefers requested permission modes over every fallback", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        requestedPermissionMode: "auto",
        lastExecutionPermissionMode: "workspace-write",
        projectExecutionPermissionMode: "full",
        thread: makeThread(),
      }),
    ).toBe("auto");
  });

  it("maps a legacy readonly execution to Accept Edits for future work", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        lastExecutionPermissionMode: "readonly",
        projectExecutionPermissionMode: "full",
        thread: makeThread(),
      }),
    ).toBe("accept-edits");
  });

  it("maps a legacy readonly parent execution before inheriting it", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread(),
        parentThreadExecutionPermissionMode: "readonly",
        projectExecutionPermissionMode: "full",
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("accept-edits");
  });

  it("uses project permission defaults for child threads without parent execution history", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread(),
        projectExecutionPermissionMode: "full",
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("full");
  });

  it("reconciles inherited parent permission to the child provider's supported modes", () => {
    // The parent ran sandboxed and Pi does not support the mode it inherited,
    // so the child takes the most capable sandboxed mode Pi does support. It
    // used to take Full Access, because that was all Pi had — a sandboxed
    // parent's child leaving the sandbox by inheritance.
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread(),
        parentThreadExecutionPermissionMode: "workspace-write",
        projectExecutionPermissionMode: "accept-edits",
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "pi",
        }),
      }),
    ).toBe("auto");
  });

  it("uses root-thread defaults when the parent reference is not live", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread({
          deletedAt: Date.now(),
        }),
        projectExecutionPermissionMode: "accept-edits",
        thread: makeThread({
          parentThreadId: "thr-deleted-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("accept-edits");
  });

  it("still uses project permission defaults for root threads", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        projectExecutionPermissionMode: "accept-edits",
        thread: makeThread(),
      }),
    ).toBe("accept-edits");
  });
});
