# pi-roundtable

Group conversations between [pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) AI agents. Spawn multiple `pi` processes as separate "peers," each with its own model and persona, and have them talk through a topic together.

```
━━━ Round 1 ━━━ researcher (researcher) ━━━
💬 researcher is speaking...
**Researcher:** Opening with the data, because "most popular Linux distro" splits...

━━━ Round 2 ━━━ critic (critic) ━━━
💬 critic is speaking...
**Critic:** Researcher — the framework is solid, but you haven't actually answered...

━━━ END ━━━ consensus reached ━━━
```

## What it does

You give it a topic. It picks 2-3 "peer" agents (each with its own model and persona). The peers take turns responding to each other until they reach consensus or hit the round limit. You watch the conversation stream to your terminal in real-time.

Each peer is a separate `pi --mode rpc` process with an isolated context window, so peers can't see each other's working notes — only the published turns. The orchestrator relays turns through a shared transcript.

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

## Quick start

```bash
# A three-way design review
pi-roundtable --preset design-review \
  --topic "Should we add Redis caching to the session store?" \
  --save

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

Each peer is a markdown file in `peers/` with a YAML frontmatter:

```markdown
---
name: my-peer
role: my-role
model: ollama-cloud/glm-5.3-flash
---

System prompt for the agent.
```

Override peers for a single run with `--peers name1,name2`, or permanently by editing the file.

**Preset** — a named combination of peers. Defaults:

| Preset | Peers | Use when |
| --- | --- | --- |
| `design-review` | researcher, critic, implementer | You want a plan at the end |
| `brainstorm` | researcher, critic | Pure ideation, no implementation pressure |
| `debug` | critic, implementer | You have a problem, want adversarial fix |

Use `--preset NAME` to invoke.

**Transcript** — saved markdown of the full conversation. Use `--save` to write one. Saved files are searchable:

```bash
pi-roundtable --search "redis" --transcripts-dir ~/decisions
pi-roundtable --show --latest --transcripts-dir ~/decisions
```

## CLI reference

```
pi-roundtable --topic "your topic" [options]

Required (unless first positional):
  -t, --topic TOPIC           The conversation topic

Composition:
  -p, --peers NAMES           Comma-separated peer names (default: all)
      --preset NAME           Use a preset peer composition
  -r, --max-rounds N          Stop after N rounds (default: 12)

Saving / loading:
  -o, --save [PATH]           Save transcript to markdown (auto-name if no path)
      --show [PATH|--latest]  Render a saved transcript
  -T, --list-transcripts [DIR] List saved transcripts (newest first)
      --search TERM           Search transcripts for TERM (case-insensitive)
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

The orchestrator relays each peer's final turn into the next peer's prompt as a transcript. Peers only see *published* turns, not each other's internal reasoning — they get a clean context per round.

Two control tokens the agents use:

- **`[YIELD]`** — peer is done speaking, hand off to the next
- **`[DONE]`** — peer thinks consensus is reached; loop stops with summary

The personas in `peers/*.md` are tuned to use these naturally. If you write a custom peer, train it on the same convention or it won't know when to stop.

## Troubleshooting

**`pi-roundtable: command not found`** — `~/.local/bin` isn't on your PATH. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc.

**`Model validation failed`** — your configured models aren't in `pi --list-models`. Run `pi-roundtable --list-models` to see the mismatch, then either edit the peer file or pass `--model name=correct-model`.

**Conversation hangs / no output** — first peer is still loading. By default you'll see `💬 <peer> is speaking...` once the first token arrives. If nothing appears for >2 minutes, the model may have failed; Ctrl+C and try with `--model researcher=ollama-cloud/glm-5.3-flash` (the cheapest model).

**Output is one wall of text** — your stdout isn't a TTY (piped to file or another process). Streaming only kicks in on a TTY. Force non-streaming with `PI_ROUNDTABLE_QUIET=1` if you want a clean file capture.

**`peer _streamedTurn` warning or other JS errors** — please open an issue with the full stack trace.

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
