const { isDeepStrictEqual } = require("node:util");

const manifestPath = "apps/desktop/package.json";
const desktopSmokeName = "Desktop Package Smoke (macos-15, arm64)";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function isDependabotPull(pull, repo) {
  return (
    pull.state === "open" &&
    !pull.draft &&
    pull.user.login === "dependabot[bot]" &&
    pull.base.ref === "main" &&
    pull.head.repo?.full_name === `${repo.owner}/${repo.repo}`
  );
}

async function readFile(github, repo, path, ref) {
  const { data } = await github.rest.repos.getContent({ ...repo, path, ref });
  if (data.encoding !== "base64")
    throw new Error(`Cannot read ${path} at ${ref}`);
  return Buffer.from(data.content, "base64").toString("utf8");
}

async function readManifests(github, repo, pull) {
  return Promise.all(
    [pull.base.sha, pull.head.sha].map(async (ref) =>
      JSON.parse(await readFile(github, repo, manifestPath, ref)),
    ),
  );
}

async function findDependabotPull(github, context) {
  const run = context.payload.workflow_run;
  if (run.event !== "pull_request") return null;
  const repo = context.repo;
  // workflow_run.pull_requests can be empty, even for same-repository PRs.
  const associated = await github.paginate(
    github.rest.repos.listPullRequestsAssociatedWithCommit,
    { ...repo, commit_sha: run.head_sha },
  );
  const candidate = associated.find(
    (pull) =>
      pull.state === "open" &&
      pull.user.login === "dependabot[bot]" &&
      pull.head.sha === run.head_sha,
  );
  if (!candidate) return null;

  const pullRequest = { ...repo, pull_number: candidate.number };
  const { data: pull } = await github.rest.pulls.get(pullRequest);
  return isDependabotPull(pull, repo) && pull.head.sha === run.head_sha
    ? pull
    : null;
}

async function mergeElectronUpdate({ github, context, core }) {
  if (context.payload.workflow_run.conclusion !== "success") return;
  const pull = await findDependabotPull(github, context);
  if (!pull || pull.mergeable_state !== "clean") {
    return core.info("PR is not ready to merge; leaving it open.");
  }

  const repo = context.repo;
  const pullRequest = { ...repo, pull_number: pull.number };
  const { data: runs } = await github.rest.actions.listWorkflowRuns({
    ...repo,
    workflow_id: "ci.yml",
    event: "pull_request",
    head_sha: pull.head.sha,
    per_page: 1,
  });
  const ci = runs.workflow_runs[0];
  if (ci?.status !== "completed" || ci.conclusion !== "success") {
    return core.info("The latest CI run has not passed.");
  }
  const jobs = await github.paginate(
    github.rest.actions.listJobsForWorkflowRun,
    {
      ...repo,
      run_id: ci.id,
    },
  );
  if (
    !jobs.some(
      (job) => job.name === desktopSmokeName && job.conclusion === "success",
    )
  ) {
    return core.info("Packaged desktop smoke has not passed.");
  }

  const files = await github.paginate(github.rest.pulls.listFiles, pullRequest);
  if (
    files.length !== 2 ||
    ![manifestPath, "bun.lock"].every((path) =>
      files.some(
        (file) => file.filename === path && file.status === "modified",
      ),
    )
  ) {
    return core.info(
      "PR contains changes beyond the Electron pin and lockfile.",
    );
  }

  const [before, after] = await readManifests(github, repo, pull);
  const oldVersion = before.devDependencies?.electron;
  const newVersion = after.devDependencies?.electron;
  if (!stableVersion.test(oldVersion) || !stableVersion.test(newVersion))
    return;
  const [oldMajor, oldMinor, oldPatch] = oldVersion.split(".").map(Number);
  const [newMajor, newMinor, newPatch] = newVersion.split(".").map(Number);
  if (
    oldMajor !== newMajor ||
    !(newMinor > oldMinor || (newMinor === oldMinor && newPatch > oldPatch))
  ) {
    return core.info("Major updates and downgrades require manual review.");
  }
  delete before.devDependencies.electron;
  delete after.devDependencies.electron;
  if (!isDeepStrictEqual(before, after)) {
    return core.info("Other manifest changes require manual review.");
  }

  // Bun stores each package on one line. Any change outside Electron's own
  // records (including new transitive versions) needs manual review.
  const lockfiles = await Promise.all(
    [pull.base.sha, pull.head.sha].map((ref) =>
      readFile(github, repo, "bun.lock", ref),
    ),
  );
  const withoutElectron = lockfiles.map((text) =>
    text.replace(/^[\t ]*"electron":.*$/gmu, ""),
  );
  if (
    lockfiles[0] === lockfiles[1] ||
    withoutElectron[0] !== withoutElectron[1]
  ) {
    return core.info("Other lockfile changes require manual review.");
  }

  // No persistent auto-merge flag: a later push must pass this policy again.
  // The SHA pins the merge; GitHub also enforces main's required checks and
  // strict up-to-date rule. This token has no ruleset bypass permission.
  await github.rest.pulls.merge({
    ...pullRequest,
    sha: pull.head.sha,
    merge_method: "squash",
  });
  core.info(
    `Merged Electron ${oldVersion} -> ${newVersion} (#${pull.number}).`,
  );
}

async function requestMajorUpdateReview({ github, context, core }) {
  const pull = await findDependabotPull(github, context);
  if (!pull) return;
  const repo = context.repo;
  const pullRequest = { ...repo, pull_number: pull.number };

  const [before, after] = await readManifests(github, repo, pull);
  const oldVersion = before.devDependencies?.electron;
  const newVersion = after.devDependencies?.electron;
  if (
    !stableVersion.test(oldVersion) ||
    !stableVersion.test(newVersion) ||
    Number(newVersion.split(".")[0]) <= Number(oldVersion.split(".")[0])
  )
    return;

  // The personal repository owner receives GitHub's review-request notification.
  const reviewer = repo.owner;
  if (pull.requested_reviewers.some((user) => user.login === reviewer)) return;
  const reviews = await github.paginate(
    github.rest.pulls.listReviews,
    pullRequest,
  );
  if (
    reviews.some(
      (review) =>
        review.user?.login === reviewer && review.commit_id === pull.head.sha,
    )
  )
    return;

  await github.rest.pulls.requestReviewers({
    ...pullRequest,
    reviewers: [reviewer],
  });
  core.info(
    `Requested ${reviewer}'s review of Electron ${oldVersion} -> ${newVersion}.`,
  );
}

module.exports = { mergeElectronUpdate, requestMajorUpdateReview };
