# pi-roundtable

Group conversations between [pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) AI agents. Spawn multiple `pi` processes as separate "peers," each with its own model and persona, and have them talk through a topic together.

```
━━━ Round 1 ━━━ researcher (researcher) ━━━
💬 researcher is speaking...
**Researcher:** Opening with the data, because "most popular Linux distro" splits...

━━━ Round 2 ━━━ critic (critic) ━━━
💬 critic is speaking...
**Critic:** Researcher — the framework is solid, but you haven't actually answered...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 CONCLUSION — ✅ consensus reached
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Topic:        Which Linux distro is most popular?
Concluded by: 🔍 researcher (researcher) at round 2 of 12 (sequential mode)

Summary:

The group agreed: "most popular" depends on the metric — server installs
favor Debian-family, desktop adoption favors Mint/Ubuntu derivatives...

━━━ END ━━━ consensus reached ━━━
```

The **conclusion is always the last content printed before the `END` footer**, so the outcome of a run is easy to find and never buried in the conversation. On `[DONE]`, a well-formatted conclusion report is printed with the summary and all details (who concluded and when, artifacts produced, task state, and each peer's final findings in orchestrated mode). If the round limit is hit without a conclusion, a clear `📋 OUTCOME — no conclusion` block explains that instead — so a completed run is never ambiguous.

## What it does

You give it a topic. It spawns multiple "peer" agents (each with its own model and persona). The peers take turns responding to each other until they reach consensus or hit the round limit. You watch the conversation stream to your terminal in real-time.

Each peer is a separate `pi --mode rpc` process with an isolated context window, so peers can't see each other's working notes — only the published turns.

Two conversation modes:

- **Sequential (legacy)** — peers speak in round-robin order; any peer can signal `[DONE]` to end
- **Orchestrated** — an `orchestrator` peer routes tasks to specific peers based on capabilities, tracks workflow state, and is the **only** peer allowed to signal `[DONE]`

Use `--mode orchestrated` (or a preset that includes `orchestrator`) to enable intelligent routing.

## When to use it

- **Design review**: have a researcher cite prior art, a critic stress-test the proposal, an implementer commit to a concrete plan
- **Architecture debates**: let two planners argue the trade-offs, then commit to a synthesis
- **Brainstorming**: two agents push back on each other's ideas until something concrete emerges
- **Self-review**: have an agent critique its own earlier work without polluting the original context

If you just want one agent to do a task, use pi's built-in `/implement` or spawn a subagent — this tool is for when you specifically want multiple perspectives to clash.

## Installation

Requires Node.js 18+ or Bun, plus the `pi` CLI on PATH.

**One-line install from GitHub:**

```bash
curl -fsSL https://raw.githubusercontent.com/sloanb/pi-roundtable/main/install.sh | bash
```

**Or clone and install:**

```bash
git clone https://github.com/sloanb/pi-roundtable.git
cd pi-roundtable
./install.sh
```

**Verify:**

```bash
pi-roundtable --help
pi-roundtable --list-presets
pi-roundtable --list-models
```

To uninstall: `rm -rf ~/.pi-roundtable ~/.local/bin/pi-roundtable`

### Updating & release channels

pi-roundtable can update itself from GitHub releases:

```bash
# Check for updates without installing (exit code 1 if one is available)
pi-roundtable --check-only

# Install the latest stable release
pi-roundtable --update

# Something broke? Restore the previous version from backup
pi-roundtable --rollback
```

**Beta releases** are published as GitHub *pre-releases* (e.g.
`v0.4.0-beta.1`). Pull them with the `prerelease` channel:

```bash
pi-roundtable --check-only --channel prerelease
pi-roundtable --update --channel prerelease
```

Stable installs never auto-receive pre-releases — `--update` defaults to the
`stable` channel, which only sees releases **not** marked "Pre-release". To
live on the beta line, always pass `--channel prerelease`. When the stable
release that graduates a beta ships, a beta install picks it up on either
channel (the updater orders `0.4.0-beta.1 < 0.4.0` correctly).

See `CHANGELOG.md` for what each release contains.

## Global configuration

pi-roundtable reads a global config file from the install path —
`~/.pi-roundtable/config.json` (relocated automatically if `PI_ROUNDTABLE_HOME`
is set). The file survives `pi-roundtable --update`. It is **optional**: no
file means built-in defaults, exactly as before.

**Precedence for every setting: CLI flag → config.json → built-in default.**

Run `pi-roundtable --config` at any time to print the effective values with
per-key provenance (`cli` / `file` / `default`) and the config file path.

Example config:

```json
{
  "defaults": {
    "preset": "design",
    "transcripts_dir": "~/roundtables",
    "save": true,
    "max_rounds": 8,
    "mode": "auto",
    "channel": "stable",
    "tags": ["design"],
    "validate_models": true,
    "model": { "researcher": "ollama-cloud/nemotron-3-ultra" },
    "tools": { "researcher": ["read", "bash", "kagi_search"] },
    "pretty": true, "compact": false, "timing": true, "thinking": true
  },
  "preset_aliases": {
    "design": "design-review",
    "cr": "orchestrated-code-review"
  }
}
```

What each key does (all optional, snake_case):

| Key | Meaning |
| --- | --- |
| `defaults.preset` | Preset used when neither `--preset` nor `--peers` is passed. May itself be an alias. |
| `defaults.transcripts_dir` | One directory for all transcripts: the default for `--transcripts-dir`, used by `--show --latest`, `--list-transcripts`, `--search`, **and** where auto-named `--save` writes. `~` expands. Explicit `--save PATH` still resolves relative to cwd. |
| `defaults.save` | Always save transcripts, like passing `--save` every run (files go to `transcripts_dir`). |
| `defaults.max_rounds` | Default `--max-rounds`. |
| `defaults.mode` | `"auto"` (detect orchestrated when an orchestrator peer is selected), `"sequential"`, or `"orchestrated"`. |
| `defaults.channel` | Default update channel for `--update`/`--check-only`. |
| `defaults.tags` | Default tags stamped on **saved** transcripts; `--tag` entries are merged in (deduped). Search filtering (`--search --tag`) is always explicit — config tags never narrow a search. |
| `defaults.validate_models` | Default for `--validate-models`. |
| `defaults.model` | Per-peer model overrides, like `--model`; CLI flags win per peer. |
| `defaults.tools` | Per-peer tool lists, like `--tools`; CLI flags win per peer. |
| `defaults.pretty` / `.compact` / `.timing` / `.thinking` | Display preferences. |
| `preset_aliases` | Short names for presets, e.g. `--preset design` → `design-review`. Aliases appear in `--list-presets` and in unknown-preset errors. |

Unknown keys print a warning and are ignored; wrong types for known keys fail
with the key path. A malformed config file is fatal on every command (so your
configured intent never silently no-ops).

Because all transcripts live in one directory by default, `--search` works as
global recall across every session — a foundation for memory-style
workflows.

## Quick start

```bash
# A three-way design review (sequential)
pi-roundtable --preset design-review \
  --topic "Should we add Redis caching to the session store?" \
  --save

# Full development lifecycle with orchestrator routing
pi-roundtable --preset orchestrated \
  --topic "Build a user authentication system with JWT"

# Code review workflow with orchestrator
pi-roundtable --preset orchestrated-code-review \
  --topic "Review PR #42: rate limiting middleware"

# Just brainstorm, fast
pi-roundtable --preset brainstorm \
  --topic "Brainstorm: name for a new internal CLI" \
  --max-rounds 4

# Custom peer selection
pi-roundtable -p researcher,critic \
  -t "Is GitHub Actions the right CI for this side project?"

# Use cheaper models to save tokens
pi-roundtable --preset brainstorm \
  --model researcher=ollama-cloud/glm-5.3-flash,critic=ollama-cloud/glm-5.3-flash \
  -t "Should we use Bun or Node for this CLI?"
```

## Concepts

**Peer** — an AI agent with a role and model. The default peers:

| Peer | Role | Best at |
| --- | --- | --- |
| `researcher` | grounds discussion in facts, cites sources | "What does the data say?" |
| `critic` | challenges assumptions, finds flaws | "What could go wrong?" |
| `implementer` | commits to concrete plans | "What would I actually do?" |
| `developer` | writes production code, tests, refactors | "Show me the implementation" |
| `code-reviewer` | reviews code for correctness, security, style | "What did the implementer miss?" |
| `committer` | handles git, commits, PR preparation | "Ship it" |
| `releaser` | versioning, changelog, publishing | "Release it" |
| `orchestrator` | routes tasks, tracks state, detects consensus | "Who does what, and when?" |

Each peer is a markdown file in `peers/` with a YAML frontmatter:

```markdown
---
name: my-peer
role: my-role
model: ollama-cloud/glm-5.3-flash
tools: read, bash, edit, write
capabilities:
  - capability-name
  - another-capability
---

System prompt for the agent.
```

The `capabilities` field (optional) tells the orchestrator what this peer is good at, enabling smart routing. Override peers for a single run with `--peers name1,name2`, or permanently by editing the file.

**Preset** — a named combination of peers. Defaults:

| Preset | Peers | Use when |
| --- | --- | --- |
| `design-review` | researcher, critic, implementer | You want a plan at the end (sequential) |
| `brainstorm` | researcher, critic | Pure ideation, no implementation pressure (sequential) |
| `debug` | critic, implementer | You have a problem, want adversarial fix (sequential) |
| `full-cycle` | researcher, critic, implementer, developer, code-reviewer, committer, releaser | Full dev lifecycle (sequential) |
| `code-review` | implementer, developer, code-reviewer, committer | Code-focused workflow (sequential) |
| `release-prep` | code-reviewer, committer, releaser | Final release stage (sequential) |
| `orchestrated` | orchestrator, researcher, critic, implementer, developer, code-reviewer, committer, releaser | Full dev lifecycle with intelligent routing |
| `orchestrated-code-review` | orchestrator, implementer, developer, code-reviewer, committer | Code review with intelligent routing |
| `orchestrated-release` | orchestrator, code-reviewer, committer, releaser | Release workflow with intelligent routing |
| `orchestrated-brainstorm` | orchestrator, researcher, critic | Idea generation with intelligent routing |

Use `--preset NAME` to invoke. Orchestrated presets auto-enable `--mode orchestrated`.

**Transcript** — saved markdown of the full conversation. Use `--save` to write one. Saved files are searchable — results are numbered, and `--show @N` jumps straight to one (numbers refer to your most recent `--search`):

```bash
pi-roundtable --search "redis" --transcripts-dir ~/decisions
pi-roundtable --show @2                  # open result 2 of that search
pi-roundtable --show --latest --transcripts-dir ~/decisions
```

## CLI reference

Mistyped flags are caught, not guessed at: anything flag-shaped (`-show`,
`--sav`) errors with a "did you mean?" suggestion instead of silently
becoming the conversation topic, and constrained values (`--mode`, `--in`,
`--channel`, `--preset`) suggest their nearest valid spelling. Extra
positionals print a warning instead of being silently dropped. For a topic
that genuinely starts with a dash, pass `--topic "-..."` or use the `--`
end-of-options separator.

```
pi-roundtable --topic "your topic" [options]

Required (unless first positional):
  -t, --topic TOPIC           The conversation topic

Composition:
  -p, --peers NAMES           Comma-separated peer names (default: all)
      --preset NAME           Use a preset peer composition
  -r, --max-rounds N          Stop after N rounds (default: 12)
      --mode MODE             Conversation mode: sequential (default), orchestrated
      --pretty                Pretty-print JSON responses in console (default on TTY)
      --no-pretty             Disable pretty-printing

Saving / loading:
  -o, --save [PATH]           Save transcript to markdown (auto-name if no path)
      --show [PATH|@N|--latest]  Render a saved transcript; @N opens result N
                              of the most recent --search ("#N" works quoted)
  -T, --list-transcripts [DIR] List saved transcripts (newest first)
      --search TERM           Search transcripts for TERM (case-insensitive);
                              results are numbered, jump with --show @N
      --in FIELD              Restrict --search: topic|outcome|peers|models|tags
      --tag NAME              Tag saved transcripts (repeatable); on --search,
                              filter to transcripts with matching tag
      --transcripts-dir DIR   For --latest, --list-transcripts, --search
      --latest                With --show/--list-transcripts: use newest by mtime

Models:
  -m, --model PAIRS           "name=model,name=model" overrides
  -L, --list-models           Show configured models, validate against pi catalog
      --validate-models       (default) Abort if any peer's model isn't in
                              `pi --list-models`
      --no-validate-models    Skip validation

Inspection:
  -n, --dry-run               Print config + first prompt, exit (no API calls)
      --config                Print the effective global configuration
                              (config.json + defaults) with per-key
                              provenance, then exit

Updating:
      --update                Check for and install the latest release from GitHub
      --check-only             Check for updates without installing
                              (exit code 1 if an update is available)
      --channel CHANNEL        Release channel: stable (default), prerelease
      --rollback               Restore previous version from backup
  -y, --yes                   Non-interactive mode (assume yes to prompts)

Other:
  -h, --help                  Show this help
```

## Worked example

A real design-review session, with three rounds:

```bash
$ pi-roundtable --preset design-review \
    --topic "Should we use Bun or Node for a new CLI tool?"
```

What you'll see:

- Topic + turn order header
- Per-round: peer name → streaming text in their color
- Each peer ends with `[YIELD]` to hand off, or `[DONE]` if they think consensus is reached
- Loop stops on `[DONE]` or `--max-rounds`
- On `[DONE]`: a `📋 CONCLUSION` block — the full summary and details — printed immediately before the `END` footer
- On `--max-rounds` without `[DONE]`: a `📋 OUTCOME — no conclusion` block explaining that no consensus was reached

Saved transcripts (`--save`) end with the same `## Conclusion` section (summary, details, and peer reports), and `--show` renders it as the final section.

Save and review later:

```bash
pi-roundtable --preset design-review -t "..." --save
pi-roundtable --show --latest
```

## Adding a peer

Create `peers/security.md`:

```markdown
---
name: security
role: security
model: ollama-cloud/qwen3.5:397b
---

You are the Security reviewer in a roundtable. You think about:
auth/authz, input validation, secrets handling, injection vectors,
supply chain. You challenge proposals that skip any of these.
Address peers by name. End with [YIELD] or [DONE] when done.
```

Re-run `pi-roundtable --list-models` to confirm it's loaded. Use it with `-p security,researcher`.

To add a preset, edit `presets.json`:

```json
{
  "security-review": {
    "description": "Researcher + security specialist + implementer",
    "peers": ["researcher", "security", "implementer"]
  }
}
```

## How the agents talk

In **sequential mode**, the orchestrator relays each peer's final turn into the next peer's prompt as a transcript. Peers only see *published* turns, not each other's internal reasoning — they get a clean context per round.

In **orchestrated mode**, the `orchestrator` peer receives structured JSON reports from each peer, maintains workflow state (completed/pending/blocked tasks, artifacts), and routes the next task to the most appropriate peer based on capabilities. See `ORCHESTRATOR_PROTOCOL.md` for the full JSON schema.

Two control tokens the agents use:

- **`[YIELD]`** — peer is done speaking, hand off. Every worker peer ends
  every turn with it; in orchestrated mode it returns control to the
  Orchestrator.
- **`[DONE]`** — signals consensus. **Authority is mode-dependent:**
  - **Orchestrated mode:** the **Orchestrator alone** may conclude — a
    worker's `[DONE]` is a completion *signal* surfaced to the Orchestrator's
    next turn, and the Orchestrator always emits the final `action: done`
    itself (including a forced wrap-up turn at the round limit, so it has
    the last say on every run). Tokens inside a worker's JSON report are
    data, not signals — a report that merely *mentions* `[DONE]` can't
    conclude anything.
  - **Sequential mode:** any peer may signal consensus per the runtime
    instruction.

On `[DONE]` the loop stops and a full conclusion report (peer reports, then
the concluding summary as the final word) is printed as the last content
before the `END` footer — and saved as the `## Conclusion` section in the
same order.

The personas in `peers/*.md` are tuned to use these naturally: workers
always `[YIELD]` and defer conclusion to the Orchestrator. If you write a
worker peer, follow the same convention — end with `[YIELD]`, never emit
`[DONE]`.

## Troubleshooting

**`pi-roundtable: command not found`** — `~/.local/bin` isn't on your PATH. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc.

**`Model validation failed`** — your configured models aren't in `pi --list-models`. Run `pi-roundtable --list-models` to see the mismatch, then either edit the peer file or pass `--model name=correct-model`.

**Conversation hangs / no output** — first peer is still loading. By default you'll see `💬 <peer> is speaking...` once the first token arrives. If nothing appears for >2 minutes, the model may have failed; Ctrl+C and try with `--model researcher=ollama-cloud/glm-5.3-flash` (the cheapest model).

**Output is one wall of text** — your stdout isn't a TTY (piped to file or another process). Streaming only kicks in on a TTY. Force non-streaming with `PI_ROUNDTABLE_QUIET=1` if you want a clean file capture.

**`peer _streamedTurn` warning or other JS errors** — please open an issue with the full stack trace.

**Spinner frames keep printing after the END banner / the process never exits** — this was a leaked thinking-animation timer (fixed in 0.3.1: the spinner is now stopped on first token and when each turn settles, and shutdown clears all animation timers). If you still see it, please open an issue.

**`Error: --topic is empty or only whitespace`** — the CLI received a blank topic, almost always a shell quoting mistake. A common cause is a trailing space after a line-continuation backslash: `--topic "..." \` escapes the *space* instead of joining the line, so the next line never becomes part of the command. Write `\` as the very last character of the line.

## Security

- The orchestrator spawns `pi --mode rpc` subprocesses; it does **not** read, write, or exfiltrate any files outside of `--save` paths
- `--save` writes only to the path you specify (or cwd if you don't)
- No telemetry, no network calls except the local `pi` subprocess's own
- See `SECURITY.md` for the threat model and how to report issues

## Requirements

- Node.js 18+ **or** Bun
- [`pi`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) on PATH (the orchestrator shells out to it)
- API keys for whichever model provider you configure (Anthropic, OpenAI, ollama-cloud, local llama.cpp, etc.)

## License

MIT — see `LICENSE`.
