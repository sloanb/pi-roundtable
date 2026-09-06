# Changelog

All notable changes to pi-roundtable are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

> **⚠️ Status: BETA.** pi-roundtable is pre-1.0 software — the 0.x line is the
> unstable line and anything may change between releases. Beta releases are
> published as GitHub pre-releases; pull them with
> `pi-roundtable --update --channel prerelease` (stable installs never
> auto-receive pre-releases).

## [0.4.0-beta.1] — BETA — 2026-09-06

### Added

- **Conclusion report.** On a `[DONE]` consensus, a well-formatted
  `📋 CONCLUSION` block — topic, who concluded and at which round, the full
  summary, artifacts produced, task state, and each peer's final findings —
  is now the last content printed before the `END` footer, in both sequential
  and orchestrated modes.
- **No-conclusion outcome block.** When `--max-rounds` is hit without `[DONE]`,
  a clear `📋 OUTCOME — no conclusion` block explains that (last speaker,
  round limit, how to continue) so a finished run is never ambiguous.
- Saved transcripts (`--save`) now end with a full `## Conclusion` section
  (Summary / Details / Peer reports), and `--show` renders it as the final
  section. Legacy `## Consensus` sections from older transcripts still render.
- Blank or whitespace-only topics are rejected with a clear error message
  (guards against shell quoting mistakes, e.g. a trailing space after a
  line-continuation backslash).
- This changelog, and an automated test that exercises `update.sh`'s
  `version_compare` against real bash.

### Fixed

- **Capability-based routing now works.** `capabilities:` block lists in peer
  frontmatter were silently never parsed — the orchestrator received empty
  capabilities in every run. They are now parsed and passed through to the
  orchestrator context.
- Peers without a `tools:` frontmatter line now get the documented default
  tools (`read, bash, edit, write`) instead of spawning with no tools at all.
- **Thinking-spinner timer leaks.** Spinner intervals could never be cleared
  (the orchestrator's ran on a throwaway object), kept the process alive
  forever after the `END` banner, and interleaved stray frames into output.
  Animation timers now stop on first token, on turn settle, and at shutdown.
- CLI/programmatic exports (`parseArgs`, `renderMarkdown`, `resolveTools`,
  etc.) were unexported in the repository head, breaking 64 tests and library
  use; restored, and `main()` now only runs when executed as a script.
- `_buildStateSummary` serializes the full workflow state, per
  `ORCHESTRATOR_PROTOCOL.md` (restores the orchestrator's routing context).
- `checkModel` accepts arrays as well as `Set`s, matching its declared
  contract.
- `renderTranscript` returns the rendered string instead of printing
  internally (its documented contract; `--show` prints it).
- `update.sh` `version_compare` now orders prerelease versions correctly
  (semver: `0.4.0-beta.1` < `0.4.0`), so beta installs correctly receive the
  stable graduation when it ships.

### Changed

- Saved-transcript consensus section renamed `## Consensus` → `## Conclusion`
  and now carries the full summary and details instead of a pointer line.
- `resolveTools` returns the resolved peer→tools map (restoring the 0.3.0
  contract); `--list-models` display resolution shares the same parser.
- Internal dedupe: `_speak` delegates to `_speakPeer`; new shared
  `_awaitTurn` / `_lastAssistantText` / `parseToolsOverrides` helpers replace
  ~90 lines of duplicated code.

## [0.3.0] — 2026-09-05

- Orchestrator architecture: orchestrated conversation mode with routing,
  workflow state, and structured peer reports; 63% test coverage; new peers
  (developer, code-reviewer, committer, releaser, orchestrator) and presets;
  TypeScript types and Vitest suite.

## [0.2.0-beta.1] — 2026-09-04

- First beta release.
