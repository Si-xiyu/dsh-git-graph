# AGENTS.md

Instructions for AI agents asked to **install** or **verify** DSH Git Graph.

## What this is

A DeepSeek Harness (DSH) plugin, installed into a **profile** with `dsh plugin add`. It has two
halves that ship together in one npm package:

- **host half** — `lib/index.js`: a Cordis plugin registering `POST /vsc-git-graph` plus the
  `/fs` route (`dsh.bundle.patch` in `package.json` points at `cordis.patch.yml`);
- **client half** — `lib/client.js`: a single-file web client loaded through
  `window.__ModuleLoader__.load({ id: "dsh-vsc-git-graph" })`, registered into the
  `conversation.view` slot as a tab labelled **Git Graph**.

Installing it means adding the package to the profile. No build step is required — `lib/` is
committed.

## Prerequisites

```sh
git --version          # required at runtime
dsh --version          # must be >= 0.1.0-rc.5
```

`dsh` is the harness CLI. On DSH Desktop for Windows it is usually at
`<install dir>\resources\runtime\cli\bin\dsh.cmd`; call it with its full path if it is not on `PATH`.

## Install (preferred: npm)

```sh
dsh plugin --profile <profile> add dsh-vsc-git-graph
```

Use the profile the app actually runs (`desktop` for DSH Desktop; `web` for `dsh web`). If unsure,
list profiles first: `dsh plugin --profile <candidate> list`.

## Install (fallback: local clone)

Use this when the npm registry is unreachable, when testing unreleased changes, or when the user
asked to install from source:

```sh
git clone https://github.com/Si-xiyu/dsh-git-graph.git
dsh plugin --profile <profile> add <ABSOLUTE-PATH-TO-THE-CLONE>
```

A `link:` install is also acceptable when the user wants live edits:
`dsh plugin --profile <profile> add link:<ABSOLUTE-PATH>`.

## Install (fallback: tarball)

```sh
npm install
npm run dist                 # produces dist/dsh-vsc-git-graph-<version>.tgz
```

Then install through the app: **Settings → Plugins → install from archive**.

## Verify

1. The package is listed: `dsh plugin --profile <profile> list` shows `dsh-vsc-git-graph`.
2. Restart the app (plugins load at startup).
3. Open a session whose working directory is inside a Git repository.
4. A **Git Graph** tab appears in the session tab bar; the graph lists commits and branch pills.

If the tab is missing, check that (a) the session directory is a Git repository (`git rev-parse
--show-toplevel`), and (b) the profile you installed into is the one the app runs.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `dsh: command not found` | Use the full path to `dsh.cmd` / `dsh` inside the DSH install directory. |
| Installed, but no tab | Wrong profile, or the app was not restarted. |
| Tab shows "not a git repository" | The session's cwd is not inside a work tree. |
| `plugin add` fails on registry access | Use the local-clone fallback; do not retry in a loop. |
| Graph is empty for a fresh repo | A repository with no commits has nothing to draw. |

## Do not

- Do **not** edit `lib/client.js` by hand — it is generated from `src/` by `npm run build`.
- Do **not** add build scripts to the install step; the published package needs none.
- Do **not** modify the user's global git config to make this plugin work.
- Do **not** commit changes into the user's repository unless the user asked for it.

## Repository map

| Path | Purpose |
|---|---|
| `lib/index.js` | host half: git operations over HTTP JSON |
| `lib/client.js` | client half: built bundle (do not hand-edit) |
| `src/` | client sources; `src/graph.js` is the layout engine |
| `docs/GRAPH-SPEC.md` | behavioural spec of the layout engine |
| `test/` | `node --test` suites (host, engine, client bundle) |
