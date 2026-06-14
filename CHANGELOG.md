# Changelog

All notable changes to Quilt are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.3] - 2026-06-14

QA hardening for multi-workspace. No behaviour change for single-workspace use.

### Fixed
- **Per-workspace tree actions now target the clicked workspace.** The Project
  root kebab ("New pipeline…", "New folder") and the folder context menus
  derived their target from hardcoded bare ids (`root`, `pipelines`, …), so with
  several workspaces open they could resolve against the wrong workspace or show
  the wrong "New X" options. They now namespace by the clicked root's token and
  compare on bare ids, so scope detection and item creation land in the right
  workspace.
- The global "+ New pipeline" defaults the folder dropdown to the active
  workspace's pipelines folder.

### Internal
- Extracted the multi-workspace hydration merge into a pure, unit-tested
  `mergeWorkspaces()` (namespacing, per-workspace open-tab restore, stale-tab
  drop, null-state tolerance), removing untested logic from the React effect.
- Verified end to end: lint, 191 unit tests, production build, and a browser
  smoke pass (boot, WORKSPACES tree, root kebab menu, New-pipeline modal) with
  zero console errors.

## [0.4.2] - 2026-06-14

Multiple workspaces open at once.

### Added
- **Multi-workspace.** Opening another workspace with "New Workspace" now ADDS
  it to the Project sidebar instead of replacing the current one, so several
  workspaces show as separate roots and you can edit pipelines from any of them
  at the same time. Each workspace's items are namespaced in memory by a stable
  per-path token so identical on-disk ids (`root`, `pipelines`, `j1`, …) from
  different folders never collide; files on disk keep their original bare ids.
- **Per-workspace close.** "Close workspace" on a root's kebab menu removes just
  that workspace from the sidebar; the others stay open. The open set is
  persisted, so reopening the app restores every workspace.

### Changed
- The active workspace (for run, Ctrl+S, scheduler) follows the focused
  pipeline's workspace. Saves are routed per-workspace: each workspace's
  `repository.json`, `quilt.json`, and pipeline files are written back to its
  own folder with bare ids.

## [0.4.1] - 2026-06-14

Multi-workspace quality-of-life pass for the Project sidebar, plus a
disk-authoritative workspace loader.

### Added
- **Disk-authoritative workspace loading.** Opening a workspace now scans the
  folder for pipeline files and shows them even when `repository.json` doesn't
  reference them (hand-dropped files, git restores, files written by external
  tools). Misplaced pipelines sitting at the workspace root are loaded and
  relocated into `pipelines/` automatically. This fixes existing pipelines not
  auto-loading when switching to a workspace.
- **Workspace name as the project root.** The Project tree's root node now shows
  the workspace folder name instead of a static "Quilt Project" label.
- **Workspace actions menu.** A kebab (⋮) on the workspace root opens a menu with
  New pipeline, New folder, and Close workspace.
- **New Workspace button.** The sidebar toolbar now has a single "New Workspace"
  button that opens another workspace folder from disk (same picker as before).

### Changed
- The Pipeline / Folder toolbar buttons moved into the workspace kebab menu.
- Removed the workspace path button from the app header (redundant with the
  named project root + New Workspace button).

## [0.4.0] - 2026-06-13

The **Qunnie** release — a rebrand of the in-app AI assistant plus a major
upgrade to its capabilities: multiple AI providers, an agentic tool-calling
loop with human-in-the-loop safety, and persistent chat history.

### Added
- **Multi-provider / multi-model AI settings.** Configure several AI providers
  at once, each with its own list of models. OpenAI-compatible endpoints
  (Ollama, LM Studio, local llama.cpp/vLLM) can now be saved **without an API
  key**.
- **Model selector in chat.** A dropdown above the chat input switches between
  any configured provider/model; the active choice is persisted.
- **Agentic ReAct loop (Qunnie).** The assistant runs a bounded think → tool →
  observe loop with a provider-agnostic JSON-block tool protocol. Includes a
  registry of inspect / edit / profile / visualize / quality skills, a
  skill-used trace, and a Stop control.
- **Human-in-the-loop (HITL) approval.** Mutating actions (add/update/delete
  node, connect, create chart, run) pause for explicit user approval before
  they touch the canvas — they never execute automatically.
- **Security guardrails.** Three defence layers: prompt hardening (role lock,
  treat graph + tool output as untrusted data, no exfiltration, no
  fabrication), graph-aware validation (referenced nodes must exist, fresh
  ids, allowlisted chart types, no self-loops), and a repeat-call guard plus a
  hard iteration cap.
- **Chat history.** A history popover (clock button) lists past sessions with
  auto-generated titles, scrollable list, and per-item delete. A plus button
  starts a new session.
- **Visualize palette icon.** The "Visualize" node category now shows a
  bar-chart icon.

### Changed
- The AI assistant is renamed **Duckie → Qunnie** across the app, all locales,
  and the README.
- The agent loop is the default chat path. With the JSON-block protocol it is a
  superset of one-shot chat: with no tool call it answers in a single turn and
  still post-processes the reply into a graph patch or a one-click pipeline
  insert. The "Agent mode" checkbox was removed.

### Fixed
- **Save AI provider config.** OpenAI-compatible providers could not be saved
  because an API key was wrongly required; the Save gate now treats the key as
  optional for that provider, and the backend omits the `Authorization` header
  when no key is set.
- **Persist active chat session.** Closing and reopening the chat panel resumes
  the last conversation instead of silently starting a new session.

[0.4.0]: https://github.com/dwickyfp/Quilt/releases/tag/v0.4.0
