import { describe, expect, it, vi } from "vitest";
import electronUpdates from "../../../.github/scripts/electron-updates.cjs";

const { mergeElectronUpdate, requestMajorUpdateReview } = electronUpdates;

function fixture(version = "41.7.1") {
  const pull = {
    number: 123,
    state: "open",
    draft: false,
    user: { login: "dependabot[bot]" },
    base: { ref: "main", sha: "base-sha" },
    head: { sha: "tested-sha", repo: { full_name: "owner/repo" } },
    mergeable_state: "clean",
    requested_reviewers: [],
  };
  const before = {
    name: "@patcher/desktop",
    devDependencies: { electron: "41.7.0", "electron-builder": "^26.8.1" },
  };
  const after = structuredClone(before);
  after.devDependencies.electron = version;
  const files = ["apps/desktop/package.json", "bun.lock"].map((filename) => ({
    filename,
    status: "modified",
  }));
  const ci = { id: 456, status: "completed", conclusion: "success" };
  const jobs = [
    { name: "Desktop Package Smoke (macos-15, arm64)", conclusion: "success" },
  ];
  const reviews = [];
  const locks = {
    before:
      '{\n  "electron": ["electron@41.7.0"],\n  "other": ["other@1.0.0"]\n}',
    after: `{\n  "electron": ["electron@${version}"],\n  "other": ["other@1.0.0"]\n}`,
  };
  const github = {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: vi.fn(),
        getContent: vi.fn(async ({ path, ref }) => ({
          data: {
            encoding: "base64",
            content: Buffer.from(
              path === "bun.lock"
                ? locks[ref === "base-sha" ? "before" : "after"]
                : JSON.stringify(ref === "base-sha" ? before : after),
            ).toString("base64"),
          },
        })),
      },
      actions: {
        listWorkflowRuns: vi.fn(async () => ({
          data: { workflow_runs: [ci] },
        })),
        listJobsForWorkflowRun: vi.fn(),
      },
      pulls: {
        get: vi.fn(async () => ({ data: pull })),
        listFiles: vi.fn(),
        merge: vi.fn(async () => ({ data: { merged: true } })),
        listReviews: vi.fn(),
        requestReviewers: vi.fn(async () => ({})),
      },
    },
    paginate: vi.fn(async (method) => {
      if (method === github.rest.repos.listPullRequestsAssociatedWithCommit)
        return [pull];
      if (method === github.rest.actions.listJobsForWorkflowRun) return jobs;
      if (method === github.rest.pulls.listFiles) return files;
      if (method === github.rest.pulls.listReviews) return reviews;
      throw new Error("Unexpected paginated API call");
    }),
  };
  const context = {
    repo: { owner: "owner", repo: "repo" },
    payload: {
      workflow_run: {
        event: "pull_request",
        conclusion: "success",
        head_sha: "tested-sha",
        // Real same-repository runs can omit the PR association here.
        pull_requests: [],
      },
    },
  };
  const core = { info: vi.fn() };
  return {
    github,
    context,
    core,
    pull,
    before,
    after,
    files,
    ci,
    jobs,
    reviews,
    locks,
  };
}

describe("Electron update merge policy", () => {
  it.each(["41.7.1", "41.8.0"])(
    "merges a tested stable update to %s with the exact tested SHA",
    async (version) => {
      const args = fixture(version);
      await mergeElectronUpdate(args);
      expect(args.github.rest.pulls.merge).toHaveBeenCalledExactlyOnceWith({
        owner: "owner",
        repo: "repo",
        pull_number: 123,
        sha: "tested-sha",
        merge_method: "squash",
      });
      expect(args.github.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: "tested-sha", per_page: 1 }),
      );
    },
  );

  it.each([
    "42.0.0",
    "40.9.0",
    "41.6.9",
    "41.7.0",
    "41.8.0-beta.1",
    "^41.8.0",
    "latest",
  ])("leaves %s for manual review", async (version) => {
    const args = fixture(version);
    await mergeElectronUpdate(args);
    expect(args.github.rest.pulls.merge).not.toHaveBeenCalled();
  });

  it.each([
    [
      "failed triggering workflow",
      (f) => (f.context.payload.workflow_run.conclusion = "failure"),
    ],
    [
      "non-PR triggering workflow",
      (f) => (f.context.payload.workflow_run.event = "push"),
    ],
    ["human author", (f) => (f.pull.user.login = "owner")],
    ["closed PR", (f) => (f.pull.state = "closed")],
    ["draft PR", (f) => (f.pull.draft = true)],
    ["other target branch", (f) => (f.pull.base.ref = "release")],
    ["fork", (f) => (f.pull.head.repo.full_name = "other/repo")],
    ["push after testing", (f) => (f.pull.head.sha = "untested-sha")],
    ["outdated base", (f) => (f.pull.mergeable_state = "behind")],
    ["required check pending", (f) => (f.pull.mergeable_state = "blocked")],
    ["newer CI still running", (f) => (f.ci.status = "in_progress")],
    ["newer CI failed", (f) => (f.ci.conclusion = "failure")],
    [
      "no CI run",
      (f) =>
        f.github.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: { workflow_runs: [] },
        }),
    ],
    ["packaging skipped", (f) => (f.jobs[0].conclusion = "skipped")],
    ["packaging failed", (f) => (f.jobs[0].conclusion = "failure")],
    ["packaging absent from older CI", (f) => f.jobs.pop()],
    ["missing lockfile", (f) => f.files.pop()],
    ["renamed lockfile", (f) => (f.files[1].status = "renamed")],
    [
      "extra source change",
      (f) =>
        f.files.push({
          filename: "apps/desktop/src/main.ts",
          status: "modified",
        }),
    ],
    [
      "other dependency changed",
      (f) => (f.after.devDependencies["electron-builder"] = "^27.0.0"),
    ],
    [
      "install script added",
      (f) => (f.after.scripts = { postinstall: "unexpected" }),
    ],
    [
      "unrelated lockfile upgrade",
      (f) =>
        (f.locks.after = f.locks.after.replace("other@1.0.0", "other@2.0.0")),
    ],
    ["lockfile unchanged", (f) => (f.locks.after = f.locks.before)],
  ])("does not merge: %s", async (_name, change) => {
    const args = fixture();
    change(args);
    await mergeElectronUpdate(args);
    expect(args.github.rest.pulls.merge).not.toHaveBeenCalled();
  });

  it("re-reads the PR to reject a push while the workflow is starting", async () => {
    const args = fixture();
    args.github.rest.pulls.get.mockResolvedValue({
      data: { ...args.pull, head: { ...args.pull.head, sha: "new-sha" } },
    });
    await mergeElectronUpdate(args);
    expect(args.github.rest.pulls.merge).not.toHaveBeenCalled();
  });

  it("keeps GitHub's rejection when the head or branch rules change at merge", async () => {
    const args = fixture();
    args.github.rest.pulls.merge.mockRejectedValue(new Error("Head changed"));
    await expect(mergeElectronUpdate(args)).rejects.toThrow("Head changed");
  });
});

describe("Electron major update notification", () => {
  it.each([null, "failure"])(
    "requests review when CI's conclusion is %s",
    async (conclusion) => {
      const args = fixture("42.0.0");
      args.context.payload.workflow_run.conclusion = conclusion;
      args.ci.conclusion = "failure";
      args.pull.mergeable_state = "blocked";
      await requestMajorUpdateReview(args);
      expect(
        args.github.rest.pulls.requestReviewers,
      ).toHaveBeenCalledExactlyOnceWith({
        owner: "owner",
        repo: "repo",
        pull_number: 123,
        reviewers: ["owner"],
      });
      expect(args.github.rest.pulls.merge).not.toHaveBeenCalled();
    },
  );

  it.each(["41.7.1", "41.8.0", "40.0.0", "42.0.0-beta.1"])(
    "does not request review for %s",
    async (version) => {
      const args = fixture(version);
      await requestMajorUpdateReview(args);
      expect(args.github.rest.pulls.requestReviewers).not.toHaveBeenCalled();
    },
  );

  it.each([
    "human",
    "fork",
    "draft",
    "closed",
    "review requested",
    "review completed",
  ])("avoids an unwanted or duplicate notification: %s", async (state) => {
    const args = fixture("42.0.0");
    if (state === "human") args.pull.user.login = "someone";
    if (state === "fork") args.pull.head.repo.full_name = "other/repo";
    if (state === "draft") args.pull.draft = true;
    if (state === "closed") args.pull.state = "closed";
    if (state === "review requested")
      args.pull.requested_reviewers.push({ login: "owner" });
    if (state === "review completed")
      args.reviews.push({ user: { login: "owner" }, commit_id: "tested-sha" });
    await requestMajorUpdateReview(args);
    expect(args.github.rest.pulls.requestReviewers).not.toHaveBeenCalled();
  });

  it("requests a fresh review when the owner only reviewed an older commit", async () => {
    const args = fixture("42.0.0");
    args.reviews.push({ user: { login: "owner" }, commit_id: "old-sha" });
    await requestMajorUpdateReview(args);
    expect(args.github.rest.pulls.requestReviewers).toHaveBeenCalledOnce();
  });
});
