<p align="center">
  <img alt="Patcher" src="https://raw.githubusercontent.com/laruss/patcher-browser/main/assets/patcher-icon.png" width="128">
</p>

# Patcher

Patcher is an agentic IDE that builds itself. It can control, customize, and automate
itself, laying the groundwork for your own software factory.

This package provides the `npx patcher-app` launcher, bundled `patcher` CLI entry, and
Node SDK export. Every surface — the web app, CLI, and HTTP API — is a
first-class way to drive Patcher. Work runs in threads you can follow live, steer at
any point, or hand off to another agent.

> Note: Patcher is in active development. Workflows and surfaces are still evolving.

Patcher is a fork of [bb](https://github.com/get-bb/bb) by Michael Yong, developed
independently of it. It has its own data directory, ports, and package names, and
does not read or migrate the state of a bb install.

## Quick Start

Patcher runs from npm and orchestrates coding agents you already have installed.

### Prerequisites

- Node.js 22.19, 24, or 26.
- Git.
- At least one supported agent provider: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), Cursor via ACP, [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent), or another ACP-compatible agent.

If you already use one of these providers, Patcher will pick up your existing
credentials. If you use multiple providers, you can mix and match per task.

### Supported host environments

- macOS
- Linux

<details>
<summary>Windows via Ubuntu on WSL2</summary>

Run all `patcher` commands inside WSL2, install Node.js, Git, and your provider CLIs
inside that WSL2 distro, and use Linux-style paths such as `/home/me/repo` or
`/mnt/c/Users/me/repo`.

Native Windows PowerShell, CMD, drive-letter paths, and UNC paths are not
supported product paths. Repos inside the WSL filesystem are recommended;
`/mnt/c/...` is intentionally supported so you can keep an existing Windows
checkout, but it is slower and less reliable for file watching.

</details>

### Install and run

```bash
npx patcher-app@latest
```

Then open: `http://localhost:38986`

To opt into the automated nightly channel:

```bash
npx patcher-app@nightly
```

Nightly versions are built from `main` and may be unstable. The `nightly`
dist-tag moves independently of the stable `latest` tag.

`npx patcher-app@latest` downloads the published `patcher-app` package, starts the server and
local host daemon, and serves the web app. It stores Patcher-managed state under
`~/.patcher/` by default. If either managed child process exits unexpectedly, the
launcher restarts that child without stopping the other one. Press `Ctrl+C` in
the terminal to stop both processes and exit with status `0`.

To stop a Patcher that runs in another terminal or in the background:

```bash
npx patcher-app stop
```

`stop` reads `patcher-app-runtime.json` from the data directory, confirms that the
recorded process really is that launcher, then stops it. Pass `--data-dir` when
the Patcher you want to stop does not use the default `~/.patcher/`.

From the app, add or open a project, start a thread, and choose the provider
you want that thread to use.

## CLI

The package also exposes the `patcher` CLI for an already-running Patcher server:

```bash
npx --package patcher-app patcher --help
```

The CLI uses the same `PATCHER_SERVER_URL` and patcher config resolution as the SDK. When
unset, it targets the default local packaged server at
`http://127.0.0.1:38986`.

## Scripting with the SDK

The package also exposes a Node SDK for scripts that drive an already-running
Patcher server:

```ts
import { PatcherSdk } from "patcher-app";

const patcher = new PatcherSdk();
const thread = await patcher.threads.spawn({
  projectId: "proj_personal",
  environment: { type: "host", workspace: { type: "personal" } },
  prompt: "Summarize my active Patcher work.",
});
await patcher.threads.wait({ threadId: String(thread.id), status: "idle" });
console.log(await patcher.threads.output({ threadId: String(thread.id) }));
```

`new PatcherSdk()` uses the same `PATCHER_SERVER_URL` and patcher config resolution as the
CLI. Pass `new PatcherSdk({ baseUrl: "http://host:38986" })` for remote or test
targets (see the remote-access note below). Scripts launched by Patcher already receive `PATCHER_SERVER_URL` and
`PATCHER_THREAD_ID` in their environment.

## Provider Credentials

Patcher uses whichever providers you have configured. Common providers:

| Provider       | Setup                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`        | Install the [Codex CLI](https://developers.openai.com/codex/cli). Then run `codex login` or configure credentials per the Codex docs.                                                          |
| `claude-code`  | Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and authenticate per its docs.                                                                                           |
| `cursor`       | Install [Cursor's agent CLI](https://cursor.com/cli) (`cursor-agent`) and authenticate per Cursor's docs.                                                                                      |
| `pi`           | See the [Pi coding agent docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent). Patcher includes a pinned Pi runtime, so it does not require an installed Pi executable. |
| `opencode`     | Install [opencode](https://opencode.ai/) and authenticate per its docs.                                                                                                                        |
| `grok`         | Install [Grok Build](https://docs.x.ai/build/overview) and authenticate with `grok login` or `XAI_API_KEY`.                                                                                    |
| `hermes-agent` | Install [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation), configure credentials with `hermes model`, then verify ACP with `hermes acp --check`.         |

Patcher indexes the documented native skill roots for Codex, Claude Code, Pi,
Cursor, OpenCode, omp, Grok Build, and Hermes Agent. It includes user roots,
project roots, and compatibility roots such as `.agents/skills`. These skills
appear in the selected provider's `/` command menu. The Skills page and
`patcher skill list` show native skills for Claude Code, Codex, and Cursor. Patcher also
reads configured Pi, omp, Grok, and Hermes skill directories, plus enabled
provider plugin skills.

Patcher reads Pi's global `~/.pi/agent` files and each workspace's `.pi` files.
This includes settings, credentials, models, packages, extensions, skills,
prompts, themes, and context files. Pi extensions can add models and tools.
Patcher loads project resources only after Pi's saved or global trust policy approves
the workspace. An unresolved `ask` decision stays untrusted because Patcher has no Pi
trust prompt.
You can still use the Pi CLI and `/login` to create this configuration.

Custom ACP agents can be configured through `customAcpAgents` in
`~/.patcher/config.json`; see the configuration docs for optional `modelCli` and
`reasoningCli` or `nativeReasoning` reasoning settings. A `logo`
field accepts an SVG, PNG, or WebP path for the provider picker icon.
The optional `nativeSkillRoots` field adds provider-native skills to the
composer. Its `user` paths resolve from the target host home directory. Its
`project` paths resolve from the selected workspace.
Top-level `sharedSkillRoots` uses the same `user` and `project` path format.
Patcher lists these sources as read-only skills. Patcher injects them into Codex, Claude,
Pi, and ACP threads. This permits one physical skill collection for Patcher and a
standalone provider CLI.

## Configuration

Use `patcher-app config` for persistent non-secret package settings under
`~/.patcher/config.json`:

```bash
npx patcher-app config set PATCHER_APP_URL https://<machine>.<tailnet>.ts.net
npx patcher-app config set PATCHER_INFERENCE codex/gpt-5.6-luna
npx patcher-app config set PATCHER_INFERENCE_FALLBACK codex/gpt-5.4-mini
npx patcher-app config set PATCHER_TRANSCRIPTION codex/gpt-transcribe
npx patcher-app config list
npx patcher-app config refresh
```

For remote access, publish the default loopback listener with Tailscale Serve. Direct tailnet or LAN access to port `38986` requires the
explicit, security-sensitive `--server-bind-host 0.0.0.0` compatibility option,
and a trusted network boundary in front of it: the public API is
unauthenticated.

Use `patcher-app client ssh-target` to configure local editor opens for remote
Patcher servers under `~/.patcher/client.json`. The target is the value that works after
`ssh`, such as `devbox` or `user@devbox`:

```bash
npx patcher-app client ssh-target set https://patcher.example.test devbox
npx patcher-app client ssh-target list
```

Use `patcher-app env` for provider credentials under `~/.patcher/env.json`:

```bash
npx patcher-app env set OPENAI_API_KEY <key>
npx patcher-app env list
npx patcher-app env unset OPENAI_API_KEY
```

`env list` redacts all values. Config and env writes ask a running local Patcher
server to reload; if Patcher is stopped, the values apply on the next start.

For all config keys, precedence, startup flags, and source-development `.env`
behavior, run `npx patcher-app config --help` and `npx patcher-app env --help`.

## Further Reading

- [Main README](https://github.com/laruss/patcher-browser#readme)
- [Architecture notes](https://github.com/laruss/patcher-browser/tree/main/docs/architecture)
