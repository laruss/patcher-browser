# patcher-plugin-github

GitHub issues and pull requests inside Patcher, with one-click agent dispatch.

Install it from the Patcher Official catalog:

```sh
patcher plugin install github
```

## What it does

- **Sidebar panel** (GitHub logo, full width): Issues and Pull requests tabs
  across every tracked repo, with a repo filter (persisted in localStorage)
  and a New issue form.
- **Issue detail**: markdown body, comments, comment box, status,
  assignee, and label editing, plus "Send agent".
  Deep-linkable via the URL hash: `#/issues/<owner>/<repo>/<number>`.
- **Send agent / Review with agent**: spawns a Patcher worker thread on the issue
  (or a review thread on the PR) in the repo's Patcher project. The issue/PR then
  shows a ⚡ pill linking to the thread.
- **Homepage section**: recent open issues with the same Send agent buttons.
- **Mentions**: `@` or `#` in any composer completes GitHub issues and PRs; the
  selected item's title/body/state is attached as agent context at send time.
- **`patcher github` CLI**: `repos`, `issues [repo]`, `prs [repo]`, `sync` — also
  discoverable by agents through the plugin-commands skill.

## Auth

Uses the GitHub CLI. If `gh auth status` passes, the plugin works; otherwise
it reports needs-configuration. No tokens are stored by the plugin.

## Which repos are tracked

- Every Patcher project source whose checkout has a GitHub `origin` remote
  (repo → project mapping is also how spawn picks the project).
- Plus the `extraRepos` setting: comma-separated `owner/repo` list.
- `defaultProject` setting: where threads spawn for repos with no project.

```
patcher plugin config github set extraRepos "owner/repo, owner/other"
patcher plugin reload github
```

A background service refreshes the issue/PR cache every 5 minutes; the
panel's Refresh button (or `patcher github sync`) forces it.

## Development

Run the checks from the repository root:

```sh
bunx turbo run typecheck test --filter=patcher-plugin-github
```
