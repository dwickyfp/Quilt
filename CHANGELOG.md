# Changelog

All notable changes to Quilt are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
