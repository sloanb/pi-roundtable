#!/usr/bin/env node
/**
 * pi-roundtable — spawn N pi RPC peers and run them as a group conversation.
 *
 * Usage:
 *   pi-roundtable --topic "Should we add Redis caching?"
 *   pi-roundtable --topic "..." --preset design-review
 *   pi-roundtable --topic "..." --peers researcher,critic,implementer
 *   pi-roundtable --list-presets
 *
 * A "roundtable" is: N agents, each with their own model + persona, taking
 * turns on a single topic. The launcher stays out of the conversation; the
 * agents talk to each other through a shared transcript the orchestrator
 * passes along.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Roundtable } from "./roundtable.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo layout: peers/ and presets.json live at <repo>/, but the CLI lives
// at <repo>/lib/pi-roundtable.mjs. Walk up one level to find them.
const REPO_ROOT = path.resolve(__dirname, "..");
const PEERS_DIR = path.join(REPO_ROOT, "peers");
const PRESETS_FILE = path.join(REPO_ROOT, "presets.json");
// Default install directory (can be overridden by PI_ROUNDTABLE_HOME env var)
const DEFAULT_INSTALL_DIR = process.env.PI_ROUNDTABLE_HOME
	? path.resolve(process.env.PI_ROUNDTABLE_HOME)
	: path.join(process.env.HOME || "~", ".pi-roundtable");

async function loadPeers() {
	const entries = await fs.readdir(PEERS_DIR);
	const peers = [];
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const content = await fs.readFile(path.join(PEERS_DIR, entry), "utf-8");
		const fm = parseFrontmatter(content);
		if (!fm.name) continue;
		peers.push({
			name: fm.name,
			role: fm.role ?? fm.name,
			model: fm.model,
			systemPrompt: fm.body,
			tools: fm.tools,
		});
	}
	return peers;
}

function parseFrontmatter(content) {
	const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!m) return { body: content };
	const fm = {};
	for (const line of m[1].split("\n")) {
		const kv = line.match(/^(\w+):\s*(.+)$/);
		if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
	}
	// Parse tools as array
	if (fm.tools) {
		fm.tools = fm.tools
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return { ...fm, body: m[2] };
}

/**
 * Slugify a topic for use in filenames. Lowercase, ascii-only, hyphenated,
 * capped at 60 chars.
 */
function slugify(s) {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "untitled"
	);
}

/**
 * Check whether a configured model string is valid against pi's catalog.
 *
 * The peer files use `<provider>/<model>` strings (e.g. "ollama-cloud/glm-5.3-flash"),
 * but `pi --list-models` reports bare IDs (e.g. "glm-5.3-flash"). So we extract
 * the bare ID from the configured string — last `/`-separated segment — and
 * check whether that bare ID exists in the catalog.
 *
 * Returns one of: "ok", "unknown", "no-catalog".
 */
function checkModel(configured, available) {
	if (!available) return "no-catalog";
	const bareId = configured.split("/").pop();
	return available.has(bareId) ? "ok" : "unknown";
}

/**
 * Query `pi --list-models` and return a Set of valid bare model IDs
 * (no provider prefix). Returns null if the query fails.
 */
async function queryAvailableModels() {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		const proc = spawn("pi", ["--list-models"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		proc.stdout.on("data", (c) => (out += c.toString()));
		proc.on("error", () => resolve(null));
		proc.on("close", () => {
			const ids = new Set();
			for (const line of out.split("\n")) {
				// Format: "provider      model                          context  max-out  ..."
				// We want the second column (bare model ID, no provider prefix).
				const m = line.match(/^\S+\s+(\S+)/);
				if (m) ids.add(m[1]);
			}
			resolve(ids);
		});
	});
}

/**
 * Print a summary of which models are configured where.
 * Three sections:
 *   1. Per-peer: model line from each peer markdown file
 *   2. Per-preset: which peers participate
 *   3. (optional) Effective model for a chosen --peers/--preset, including --model overrides
 * Unknown models (not in `pi --list-models`) are flagged with a warning.
 */
async function runListModels({ args, presets, allPeers }) {
	const available = await queryAvailableModels();

	console.log(`━━━ PEER MODELS (from ${PEERS_DIR}) ━━━`);
	if (allPeers.length === 0) {
		console.log("  (no peer files found)");
	} else {
		const nameW = Math.max(...allPeers.map((p) => p.name.length), 4);
		const modelW = Math.max(
			...allPeers.map((p) => (p.model ?? "(default)").length),
			5,
		);
		for (const p of allPeers) {
			const model = p.model ?? "(default)";
			const status = checkModel(model, available);
			const valid = status === "ok" ? "✓" : status === "unknown" ? "?" : " ";
			const note = status === "unknown" ? "  ⚠ not in pi --list-models" : "";
			console.log(
				`  ${valid} ${p.name.padEnd(nameW)}  ${model.padEnd(modelW)}${note}`,
			);
		}
	}

	console.log(`\n━━━ PRESETS (from ${PRESETS_FILE}) ━━━`);
	if (Object.keys(presets).length === 0) {
		console.log("  (no presets defined)");
	} else {
		for (const [name, def] of Object.entries(presets)) {
			console.log(`  ${name}`);
			console.log(`    ${def.description ?? ""}`);
			console.log(`    peers: ${def.peers.join(", ")}`);
		}
	}

	// Section 3: effective resolution if --peers or --preset was supplied
	if (args.peers || args.preset) {
		const peerMap = new Map(allPeers.map((p) => [p.name, p]));
		let selected;
		if (args.preset) {
			const preset = presets[args.preset];
			if (!preset) {
				console.error(
					`\nUnknown preset: ${args.preset}. Available: ${Object.keys(presets).join(", ")}`,
				);
				process.exit(1);
			}
			selected = preset.peers.map((n) => peerMap.get(n)).filter(Boolean);
		} else {
			selected = args.peers.map((n) => peerMap.get(n)).filter(Boolean);
		}

		// Apply overrides (same logic as the real run)
		const overridesApplied = [];
		if (args.model) {
			const overrides = new Map();
			for (const pair of args.model.split(",")) {
				const [name, model] = pair.split("=").map((s) => s.trim());
				if (name && model) overrides.set(name, model);
			}
			for (const peer of selected) {
				if (overrides.has(peer.name)) {
					peer.model = overrides.get(peer.name);
					overridesApplied.push(peer.name);
				}
			}
		}

		console.log("\n━━━ EFFECTIVE RESOLUTION ━━━");
		console.log(
			`  Source: ${args.preset ? `preset "${args.preset}"` : `--peers ${args.peers.join(",")}`}`,
		);
		if (overridesApplied.length > 0) {
			console.log(`  --model overrides applied: ${overridesApplied.join(", ")}`);
		} else if (args.model) {
			console.log(`  --model supplied but no matches in this selection`);
		}

		// Resolve tools for display (same logic as real run)
		const presetTools =
			args.preset && presets[args.preset]?.tools ? presets[args.preset].tools : {};
		const cliOverrides = new Map();
		if (args.tools) {
			const parts = args.tools.split(",").map((s) => s.trim());
			let currentName = null;
			let currentTools = [];
			for (const part of parts) {
				const eqIdx = part.indexOf("=");
				if (eqIdx > 0) {
					if (currentName) cliOverrides.set(currentName, currentTools);
					currentName = part.slice(0, eqIdx);
					currentTools = part
						.slice(eqIdx + 1)
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
				} else if (currentName) {
					currentTools.push(part);
				}
			}
			if (currentName) cliOverrides.set(currentName, currentTools);
		}
		for (const peer of selected) {
			if (cliOverrides.has(peer.name)) {
				peer.tools = cliOverrides.get(peer.name);
			} else if (presetTools[peer.name]) {
				peer.tools = presetTools[peer.name];
			} else if (!peer.tools) {
				peer.tools = ["read", "bash", "edit", "write"];
			}
		}

		const nameW = Math.max(...selected.map((p) => p.name.length), 4);
		const modelW = Math.max(
			...selected.map((p) => (p.model ?? "(default)").length),
			5,
		);
		for (const p of selected) {
			const model = p.model ?? "(default)";
			const status = checkModel(model, available);
			const valid = status === "ok" ? "✓" : status === "unknown" ? "?" : " ";
			const note = status === "unknown" ? "  ⚠ not in pi --list-models" : "";
			const override = overridesApplied.includes(p.name) ? "  (override)" : "";
			const toolsStr = p.tools?.join(", ") ?? "(default: read, bash, edit, write)";
			console.log(
				`  ${valid} ${p.name.padEnd(nameW)}  ${model.padEnd(modelW)}${note}${override}`,
			);
			console.log(`  ${" ".padEnd(nameW + modelW + 4)}tools: ${toolsStr}`);
		}
	}

	if (!available) {
		console.log(
			"\n(note: could not query `pi --list-models` to validate model strings)",
		);
	}
}

/**
 * Print the resolved roundtable configuration as it would actually run,
 * including the first prompt that would be sent to the first peer.
 * No subprocesses are spawned.
 */
function printDryRun({ topic, peers, maxRounds, cwd, savePath }) {
	console.log("━━━ DRY RUN ━━━ no agents will be spawned\n");
	console.log(`Topic:        ${topic}`);
	console.log(`Max rounds:   ${maxRounds}`);
	console.log(`Cwd:          ${cwd}`);
	console.log(
		`Save path:    ${savePath ?? "(none — add --save to write a transcript)"}`,
	);
	console.log(
		`Turn order:   ${peers.map((p) => `${p.name} (${p.role})`).join(" → ")}`,
	);
	console.log("\nPeers:");
	for (const p of peers) {
		console.log(`  - name:  ${p.name}`);
		console.log(`    role:  ${p.role}`);
		console.log(`    model: ${p.model ?? "(default)"}`);
		console.log(
			`    tools: ${p.tools?.join(", ") ?? "(default: read, bash, edit, write)"}`,
		);
		const sysPrompt = (p.systemPrompt ?? "").trim();
		const lines = sysPrompt.split("\n");
		const preview = lines.slice(0, 3).join("\n             ");
		console.log(`    system prompt (first 3 lines):`);
		console.log(
			`             ${preview}${lines.length > 3 ? "\n             ..." : ""}`,
		);
	}

	console.log("\nFirst prompt that would be sent to '" + peers[0].name + "':");
	console.log("---");
	const firstInstruction = `The topic is:\n\n${topic}\n\nYou go first. Open the discussion. End with [YIELD] when you're ready for the next speaker.`;
	console.log(firstInstruction);
	console.log("---");
}

/**
 * Render a roundtable transcript as a self-contained markdown document.
 * Includes YAML frontmatter (date, topic, peers, models, rounds, outcome)
 * and per-turn sections. Last turn is highlighted as the conclusion if
 * `consensus` is true.
 */
function renderMarkdown({
	topic,
	peers,
	rounds,
	consensus,
	transcript,
	startedAt,
	endedAt,
	tags = [],
}) {
	const fmt = (ts) => new Date(ts).toISOString();
	const lines = [];
	lines.push("---");
	lines.push(`date: ${fmt(startedAt)}`);
	lines.push(`ended: ${fmt(endedAt)}`);
	lines.push(`duration_seconds: ${Math.round((endedAt - startedAt) / 1000)}`);
	lines.push(`topic: ${JSON.stringify(topic)}`);
	lines.push(`rounds: ${rounds}`);
	lines.push(`outcome: ${consensus ? "consensus" : "max-rounds-reached"}`);
	if (tags.length > 0) {
		lines.push("tags:");
		for (const t of tags) lines.push(`  - ${JSON.stringify(t)}`);
	}
	lines.push("peers:");
	for (const p of peers) {
		lines.push(`  - name: ${p.name}`);
		lines.push(`    role: ${p.role}`);
		lines.push(`    model: ${p.model ?? "(default)"}`);
	}
	lines.push("---");
	lines.push("");
	lines.push(`# Roundtable: ${topic}`);
	lines.push("");
	lines.push(
		`> ${transcript.length} turns · ${consensus ? "consensus reached" : "max rounds reached"} after ${rounds} round(s)`,
	);
	lines.push("");
	lines.push("## Participants");
	lines.push("");
	for (const p of peers) {
		lines.push(`- **${p.name}** (${p.role}) — \`${p.model ?? "(default)"}\``);
	}
	lines.push("");

	for (const t of transcript) {
		const heading = `### Round ${t.round} · ${t.peer}`;
		lines.push(heading);
		lines.push("");
		lines.push(t.text.trim());
		lines.push("");
	}

	if (consensus && transcript.length > 0) {
		const last = transcript[transcript.length - 1];
		lines.push("## Consensus");
		lines.push("");
		lines.push(
			`Reached at round ${last.round} by **${last.peer}** (${last.role}). The final statement above is the agreed conclusion.`,
		);
		lines.push("");
	}

	return lines.join("\n");
}

async function loadPresets() {
	try {
		return JSON.parse(await fs.readFile(PRESETS_FILE, "utf-8"));
	} catch {
		return {};
	}
}

function parseArgs(argv) {
	const args = {
		topic: null,
		peers: null,
		preset: null,
		maxRounds: 12,
		listPresets: false,
		listModels: false,
		listTranscripts: false,
		show: null,
		latest: false,
		transcriptsDir: null,
		search: null,
		inField: null,
		tag: [],
		help: false,
		save: null,
		model: null,
		dryRun: false,
		validateModels: true,
		tools: null,
		update: false,
		checkOnly: false,
		rollback: false,
		yes: false,
		mode: "sequential",
		pretty: true,
		modeExplicit: false,
		compact: false,
		timing: true,
		thinking: true,
	};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--topic" || a === "-t") args.topic = argv[++i];
		else if (a === "--peers" || a === "-p")
			args.peers = argv[++i].split(",").map((s) => s.trim());
		else if (a === "--preset") args.preset = argv[++i];
		else if (a === "--max-rounds" || a === "-r")
			args.maxRounds = parseInt(argv[++i], 10);
		else if (a === "--save" || a === "-o") {
			const next = argv[i + 1];
			if (next && !next.startsWith("-")) {
				args.save = argv[++i];
			} else {
				args.save = "";
			}
		} else if (a === "--model" || a === "-m") args.model = argv[++i];
		else if (a === "--tools") args.tools = argv[++i];
		else if (a === "--update") args.update = true;
		else if (a === "--check-only") args.checkOnly = true;
		else if (a === "--rollback") args.rollback = true;
		else if (a === "--yes" || a === "-y") args.yes = true;
		else if (a === "--channel") args.channel = argv[++i];
		else if (a === "--mode") {
			args.mode = argv[++i];
			args.modeExplicit = true;
		} else if (a === "--pretty") args.pretty = true;
		else if (a === "--no-pretty") args.pretty = false;
		else if (a === "--dry-run" || a === "-n") args.dryRun = true;
		else if (a === "--validate-models") args.validateModels = true;
		else if (a === "--no-validate-models") args.validateModels = false;
		else if (a === "--compact") args.compact = true;
		else if (a === "--no-compact") args.compact = false;
		else if (a === "--timing") args.timing = true;
		else if (a === "--no-timing") args.timing = false;
		else if (a === "--thinking") args.thinking = true;
		else if (a === "--no-thinking") args.thinking = false;
		else if (a === "--tag") {
			// repeatable
			const next = argv[++i];
			if (Array.isArray(args.tag)) args.tag.push(next);
			else args.tag = [next];
		} else if (a === "--list-presets") args.listPresets = true;
		else if (a === "--list-models" || a === "-L") args.listModels = true;
		else if (a === "--list-transcripts" || a === "-T") {
			args.listTranscripts = true;
			const next = argv[i + 1];
			if (next && !next.startsWith("-")) {
				args.transcriptsDir = next;
				i++;
			}
		} else if (a === "--show") {
			const laterHasLatest = argv.slice(i + 1).includes("--latest");
			if (laterHasLatest) {
				args.show = true;
			} else {
				const next = argv[i + 1];
				if (next && !next.startsWith("-")) {
					args.show = next;
					i++;
				} else {
					args.show = true;
				}
			}
		} else if (a === "--latest") args.latest = true;
		else if (a === "--transcripts-dir") args.transcriptsDir = argv[++i];
		else if (a === "--search") args.search = argv[++i];
		else if (a === "--in") args.inField = argv[++i];
		else if (a === "--help" || a === "-h") args.help = true;
		else if (!args.topic) args.topic = a;
	}
	if (args.save === true || args.save === "") args.save = "";
	return args;
}

function printHelp() {
	console.log(`pi-roundtable — group conversation between pi agents

Usage:
  pi-roundtable --topic "your topic" [--peers a,b,c] [--preset NAME]
                [--max-rounds N] [--save PATH]

Options:
  -t, --topic TOPIC       The conversation topic (required, or first positional)
  -p, --peers NAMES       Comma-separated peer names from the install's peers/ dir
      --preset NAME       Use a preset peer composition
  -r, --max-rounds N      Stop after N rounds (default: 12)
  -o, --save [PATH]       Save transcript to markdown. If PATH is omitted,
                          auto-generates roundtable-<topic>-<timestamp>.md in cwd
  -m, --model PAIRS      Override models: "researcher=ollama-cloud/glm-5.3-flash,critic=..."
                          Comma-separated name=model pairs. Names must match peer names.
      --tools PAIRS      Override tools: "researcher=read,bash,kagi_search,critic=read,bash,lsp_diagnostics"
                          Comma-separated name=tool1,tool2 pairs. Names must match peer names.
  -n, --dry-run          Print the resolved configuration and first prompt, then exit.
                          No agents are spawned, no API calls are made.
      --validate-models   (default) Abort if any peer's model isn't in "pi --list-models"
      --no-validate-models  Skip model validation. Use if "pi --list-models" is failing
                          or you've added a model that isn't picked up yet.
      --list-presets      List available presets and exit
  -L, --list-models      Show which model each peer would use, then exit. Resolves
                          presets and --model overrides without spawning agents.
  -T, --list-transcripts [DIR]  List saved transcripts (newest first). DIR defaults
                          to current directory; looks for roundtable-*.md files.
      --show PATH         Render a saved transcript to the terminal, with color.
      --latest            (with --show or --list-transcripts) use the most recent
                          transcript by mtime in --transcripts-dir (default: cwd).
      --transcripts-dir DIR  Override the directory used by --latest and
                          --list-transcripts (default: cwd).
      --search TERM       Search all transcripts in --transcripts-dir (or cwd) for
                          TERM (case-insensitive substring). Matches in topic + body
                          by default. Use --in to scope to a single field.
      --in FIELD          Restrict --search to one field: topic, outcome, peers,
                          models, tags.
      --tag NAME          Tag the saved transcript (repeatable). On --search,
                          filter to transcripts with at least one matching tag.
      --update             Check for and install the latest release from GitHub
      --check-only        Check for updates without installing (exit code 1 if update available)
      --rollback          Restore previous version from backup
  -y, --yes               Non-interactive mode (assume yes to prompts)
      --channel CHANNEL   Release channel: stable (default), prerelease
      --mode MODE         Conversation mode: sequential (default), orchestrated
      --pretty              Pretty-print JSON responses in console (default on TTY)
      --no-pretty           Disable pretty-printing
      --compact             Compact mode: shorter headers, condensed end banner
      --no-compact          Disable compact mode
      --timing              Show turn timing (default: on)
      --no-timing           Disable turn timing
      --thinking            Show thinking animation while waiting for first token (default: on)
      --no-thinking         Disable thinking animation
  -h, --help              Show this help

Mode examples:
  pi-roundtable --preset orchestrated --topic "..."           # Orchestrated full cycle
  pi-roundtable --preset orchestrated-code-review --topic "..." # Orchestrated code review
  pi-roundtable --mode sequential --preset design-review --topic "..." # Sequential (legacy)

Agents end their turn with [YIELD] to hand off, or [DONE] if they think the
  discussion has reached consensus. The roundtable stops on [DONE] or when max
  rounds is hit. Ctrl+C at any time.
`);
}

/**
 * Resolve tools for each peer with priority:
 * 1. CLI --tools override (highest)
 * 2. Preset tools object
 * 3. Peer file tools field
 * 4. Default: ["read", "bash", "edit", "write"]
 */
function resolveTools({ selected, args, presets }) {
	const presetTools =
		args.preset && presets[args.preset]?.tools ? presets[args.preset].tools : {};

	// Parse CLI --tools override: "name=tool1,tool2,name=tool3"
	const cliOverrides = new Map();
	if (args.tools) {
		// Split by comma but respect name=value pairs
		// Strategy: split by comma, then group by name= prefix
		const parts = args.tools.split(",").map((s) => s.trim());
		let currentName = null;
		let currentTools = [];
		for (const part of parts) {
			const eqIdx = part.indexOf("=");
			if (eqIdx > 0) {
				// New name=tools pair
				if (currentName) {
					cliOverrides.set(currentName, currentTools);
				}
				currentName = part.slice(0, eqIdx);
				currentTools = part
					.slice(eqIdx + 1)
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
			} else if (currentName) {
				// Continuation of tools for current name
				currentTools.push(part);
			}
		}
		if (currentName) {
			cliOverrides.set(currentName, currentTools);
		}
	}

	// Resolve for each selected peer
	for (const peer of selected) {
		if (cliOverrides.has(peer.name)) {
			peer.tools = cliOverrides.get(peer.name);
		} else if (presetTools[peer.name]) {
			peer.tools = presetTools[peer.name];
		} else if (peer.tools) {
			// Already loaded from peer file
		} else {
			peer.tools = ["read", "bash", "edit", "write"];
		}
	}

	return { cliOverrides };
}

async function main() {
	const args = parseArgs(process.argv);

	if (args.help) {
		printHelp();
		return;
	}

	const presets = await loadPresets();
	const allPeers = await loadPeers();

	if (args.listPresets) {
		console.log("Available presets:");
		for (const [name, def] of Object.entries(presets)) {
			console.log(`  ${name.padEnd(20)} ${def.description ?? ""}`);
			console.log(`  ${"".padEnd(20)} peers: ${def.peers.join(", ")}`);
		}
		return;
	}

	if (args.listModels) {
		await runListModels({ args, presets, allPeers });
		return;
	}

	if (args.listTranscripts) {
		const dir = args.transcriptsDir
			? path.isAbsolute(args.transcriptsDir)
				? args.transcriptsDir
				: path.join(process.cwd(), args.transcriptsDir)
			: process.cwd();
		await runListTranscripts(dir);
		return;
	}

	if (args.show !== null || args.latest) {
		await runShow({
			path: args.show,
			latest: args.latest,
			transcriptsDir: args.transcriptsDir,
		});
		return;
	}

	if (args.search) {
		const dir = args.transcriptsDir
			? path.isAbsolute(args.transcriptsDir)
				? args.transcriptsDir
				: path.join(process.cwd(), args.transcriptsDir)
			: process.cwd();
		await runSearch({
			dir,
			term: args.search,
			inField: args.inField,
			tagsFilter: args.tag ?? [],
			showAll: false,
		});
		return;
	}

	// Handle update commands before requiring topic
	if (args.update || args.checkOnly || args.rollback) {
		await handleUpdate({ args, installDir: DEFAULT_INSTALL_DIR });
		return;
	}

	if (!args.topic) {
		console.error(
			"Error: --topic is required (or pass the topic as the first positional argument).",
		);
		console.error("Run with --help for usage.");
		process.exit(1);
	}
	const peerMap = new Map(allPeers.map((p) => [p.name, p]));

	let selected;
	if (args.preset) {
		const preset = presets[args.preset];
		if (!preset) {
			console.error(
				`Unknown preset: ${args.preset}. Available: ${Object.keys(presets).join(", ")}`,
			);
			process.exit(1);
		}
		selected = preset.peers.map((n) => peerMap.get(n)).filter(Boolean);
	} else if (args.peers) {
		selected = args.peers.map((n) => peerMap.get(n)).filter(Boolean);
		if (selected.length === 0) {
			console.error("No matching peers found. Available:");
			for (const p of allPeers) console.error(`  ${p.name} (${p.role})`);
			process.exit(1);
		}
	} else {
		// Default: all peers in alphabetical sequence
		selected = allPeers;
	}

	// Apply --model overrides: "name=model,name=model"
	if (args.model) {
		const overrides = new Map();
		for (const pair of args.model.split(",")) {
			const [name, model] = pair.split("=").map((s) => s.trim());
			if (name && model) overrides.set(name, model);
		}
		for (const peer of selected) {
			if (overrides.has(peer.name)) {
				peer.model = overrides.get(peer.name);
			}
		}
		// warn on typos
		const selectedNames = new Set(selected.map((p) => p.name));
		for (const name of overrides.keys()) {
			if (!selectedNames.has(name)) {
				console.error(
					`Warning: --model override "${name}" doesn't match any selected peer. Ignored.`,
				);
			}
		}
	}

	// Resolve tools per peer
	resolveTools({ selected, args, presets, allPeers });

	// Compute the save path up front so dry-run can show it.
	let savePath = null;
	if (args.save !== null) {
		if (!args.save) {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			savePath = path.join(
				process.cwd(),
				`roundtable-${slugify(args.topic)}-${stamp}.md`,
			);
		} else if (path.isAbsolute(args.save)) {
			savePath = args.save;
		} else {
			savePath = path.join(process.cwd(), args.save);
		}
	}

	if (args.dryRun) {
		printDryRun({
			topic: args.topic,
			peers: selected,
			maxRounds: args.maxRounds,
			cwd: process.cwd(),
			savePath,
		});
		return;
	}

	// Validate models against pi's catalog. Default is strict; --no-validate-models
	// skips this check (use only if you have a good reason — e.g. pi --list-models
	// is failing or you've added a model that isn't picked up yet).
	if (args.validateModels) {
		const available = await queryAvailableModels();
		if (available === null) {
			console.error(
				"⚠ Warning: could not query `pi --list-models` — skipping model validation.",
			);
			console.error("  Use --no-validate-models to silence this warning.");
		} else {
			const unknown = [];
			for (const p of selected) {
				const status = checkModel(p.model ?? "", available);
				if (status === "unknown") unknown.push(p);
			}
			if (unknown.length > 0) {
				console.error("");
				console.error(
					"✗ Model validation failed — aborting before spawning agents.",
				);
				console.error("");
				for (const p of unknown) {
					console.error(`  ${p.name.padEnd(12)} ${p.model ?? "(default)"}`);
				}
				console.error("");
				console.error("Fix options:");
				console.error(`  - Edit the model line in ${PEERS_DIR}/<name>.md`);
				console.error("  - Pass --model <name>=<correct-model> on the CLI");
				console.error("  - Run `pi --list-models` to see available models");
				console.error("  - Or pass --no-validate-models to bypass this check");
				process.exit(1);
			}
		}
	}

	const ac = new AbortController();
	process.on("SIGINT", () => {
		console.log("\n[interrupted — shutting down peers]");
		ac.abort();
	});

	// Auto-detect orchestrated mode if orchestrator peer is present
	const hasOrchestrator = selected.some((p) => p.name === "orchestrator");
	let mode;
	if (args.modeExplicit) {
		// User explicitly requested a mode
		if (args.mode === "orchestrated" && !hasOrchestrator) {
			console.error("\n✗ --mode orchestrated requires an orchestrator peer.");
			console.error(
				"  The selected preset does not include an orchestrator peer.",
			);
			console.error(
				"  Use a preset with orchestrator (e.g., orchestrated, orchestrated-code-review)",
			);
			console.error("  Or add orchestrator to your custom peer list.");
			process.exit(1);
		}
		mode = args.mode;
	} else {
		// Auto-detect: use orchestrated only if orchestrator peer is present
		mode = hasOrchestrator ? "orchestrated" : "sequential";
	}

	const rt = new Roundtable({
		peers: selected,
		topic: args.topic,
		maxRounds: args.maxRounds,
		signal: ac.signal,
		color: process.stdout.isTTY,
		mode,
		pretty: process.stdout.isTTY && args.pretty !== false,
		compact: args.compact,
		showTiming: args.timing,
		showThinking: args.thinking,
	});

	const startedAt = Date.now();
	const result = await rt.run();
	const endedAt = Date.now();

	if (savePath !== null) {
		const md = renderMarkdown({
			topic: args.topic,
			peers: selected,
			rounds: result.rounds,
			consensus: result.consensus,
			transcript: result.transcript,
			startedAt,
			endedAt,
			tags: args.tag ?? [],
		});
		await fs.writeFile(savePath, md, "utf-8");
		process.stdout.write(`\n[saved transcript to ${savePath}]\n`);
	}
}

/**
 * Parse a saved roundtable transcript's frontmatter + body.
 * Returns { meta, body } where meta has the YAML keys as a flat object,
 * including `peers` (array of {name, role, model}).
 *
 * Returns null if the file doesn't look like a roundtable transcript
 * (no frontmatter, or missing the required `topic` key).
 */
async function readTranscript(filePath) {
	const content = await fs.readFile(filePath, "utf-8");
	const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!m) return null;
	const meta = {};
	const peers = [];
	const tags = [];

	// State machine over frontmatter lines. We support two array sections:
	//   peers: and tags:. Within an array, lines look like:
	//     - key: value          # starts a new array entry
	//     key: value            # nested key of the current entry
	//     key:                  # empty section heading -> exits array mode
	let mode = null; // null | "peers" | "tags"
	for (const line of m[1].split("\n")) {
		if (line.startsWith("peers:")) {
			mode = "peers";
			continue;
		}
		if (line.startsWith("tags:")) {
			mode = "tags";
			continue;
		}
		if (/^[a-zA-Z_]/.test(line) && line.includes(":")) {
			mode = null; // a top-level key exits array mode
		}
		if (mode === "peers") {
			const nm = line.match(/^\s*-\s*name:\s*(.+)$/);
			if (nm) {
				peers.push({ name: nm[1].replace(/^["']|["']$/g, "").trim() });
				continue;
			}
			const kv = line.match(/^\s+(role|model):\s*(.+)$/);
			if (kv && peers.length > 0) {
				peers[peers.length - 1][kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
			}
			continue;
		}
		if (mode === "tags") {
			const t = line.match(/^\s*-\s*(.+)$/);
			if (t) tags.push(t[1].replace(/^["']|["']$/g, "").trim());
			continue;
		}
		const top = line.match(/^([\w]+):\s*(.+)$/);
		if (top) {
			let v = top[2].replace(/^["']|["']$/g, "").trim();
			if (/^\d+$/.test(v)) v = parseInt(v, 10);
			meta[top[1]] = v;
		}
	}
	meta.peers = peers;
	meta.tags = tags;
	if (!meta.topic) return null;
	return { meta, body: m[2] };
}

/**
 * Find all roundtable transcripts in a directory (non-recursive).
 * Returns [{ path, mtimeMs, meta }] sorted newest-first.
 */
async function findTranscripts(dir) {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const out = [];
	for (const e of entries) {
		if (!e.isFile() || !e.name.endsWith(".md")) continue;
		// Don't filter by filename prefix — some users --save with a custom name.
		// readTranscript() checks for frontmatter with `topic`, so non-roundtable
		// .md files are filtered out naturally.
		const full = path.join(dir, e.name);
		try {
			const stat = await fs.stat(full);
			const t = await readTranscript(full);
			if (t)
				out.push({ path: full, mtimeMs: stat.mtimeMs, meta: t.meta, body: t.body });
		} catch {
			/* skip unreadable */
		}
	}
	return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

const ROLE_COLOR = {
	researcher: "\x1b[36m", // cyan
	critic: "\x1b[33m", // yellow
	implementer: "\x1b[32m", // green
	referee: "\x1b[35m", // magenta
	user: "\x1b[2m", // dim
	reset: "\x1b[0m",
};

const RESET = "\x1b[0m";

function colorize(role, text) {
	const c = ROLE_COLOR[role] ?? "\x1b[37m";
	return `${c}${text}${RESET}`;
}

/**
 * Print a saved transcript in a readable form. Honors process.stdout.isTTY
 * for color, and falls back to plain text when piped.
 */
function renderTranscript({ meta, body }, { color = true } = {}) {
	const c = (role, text) => (color ? colorize(role, text) : text);

	const lines = [];
	lines.push(c("user", `━━━ TRANSCRIPT ━━━`));
	lines.push("");
	lines.push(c("user", `Topic:    ${meta.topic}`));
	if (meta.date)
		lines.push(
			c("user", `Date:     ${meta.date}${meta.ended ? ` → ${meta.ended}` : ""}`),
		);
	if (meta.duration_seconds != null) {
		const s = meta.duration_seconds;
		const dur = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
		lines.push(c("user", `Duration: ${dur}`));
	}
	if (meta.outcome) {
		const ok = meta.outcome === "consensus";
		lines.push(
			c(
				ok ? "user" : "critic",
				`Outcome:  ${meta.outcome}${meta.rounds == null ? "" : ` (after ${meta.rounds} round${meta.rounds === 1 ? "" : "s"})`}`,
			),
		);
	}
	if (meta.peers && meta.peers.length > 0) {
		lines.push(
			c(
				"user",
				`Peers:    ${meta.peers.map((p) => `${p.name} (${p.role ?? "?"})`).join(", ")}`,
			),
		);
		for (const p of meta.peers) {
			if (p.model) lines.push(c("user", `          ${p.name}: ${p.model}`));
		}
	}
	lines.push("");

	// Parse the body line-by-line, accumulating turns and other sections.
	// Lines look like:
	//   # Roundtable: <topic>
	//   > summary line
	//   ## Participants
	//   - peer list
	//   ### Round N · peerName
	//   <turn text>
	//   ## Consensus
	//   <consensus text>
	const bodyLines = body.split("\n");
	const peers = meta.peers ?? [];
	const findRole = (name) => peers.find((p) => p.name === name)?.role ?? "user";

	let i = 0;
	let turnBuffer = [];
	let turnPeer = null;
	let turnRound = null;

	const flushTurn = () => {
		if (!turnPeer) return;
		lines.push(c("user", `━━━ Round ${turnRound} · ${turnPeer} ━━━`));
		lines.push("");
		lines.push(c(findRole(turnPeer), turnBuffer.join("\n").trim()));
		lines.push("");
		turnBuffer = [];
		turnPeer = null;
		turnRound = null;
	};

	while (i < bodyLines.length) {
		const line = bodyLines[i];
		const roundMatch = line.match(/^### Round (\d+) · (.+)$/);
		if (roundMatch) {
			flushTurn();
			turnRound = roundMatch[1];
			turnPeer = roundMatch[2].trim();
			i++;
			// Accumulate until next heading
			while (i < bodyLines.length && !bodyLines[i].match(/^#{1,3}\s+/)) {
				turnBuffer.push(bodyLines[i]);
				i++;
			}
			continue;
		}
		i++;
	}
	flushTurn();
	console.log(lines.join("\n"));
}

async function runListTranscripts(dir) {
	const transcripts = await findTranscripts(dir);
	if (transcripts.length === 0) {
		console.log(`No roundtable transcripts found in ${dir}`);
		console.log(`(looking for *.md files with valid roundtable frontmatter)`);
		return;
	}
	console.log(`Transcripts in ${dir} (${transcripts.length}, newest first):\n`);
	const dateW = 20;
	const durW = 7;
	const roundsW = 6;
	const outcomeW = 18;
	const tagsW = Math.max(
		...transcripts.map((t) => (t.meta.tags ?? []).join(",").length || 0),
		4,
	);
	const pathW = Math.max(
		...transcripts.map((t) => path.relative(dir, t.path).length),
		30,
	);
	console.log(
		`  ${"DATE".padEnd(dateW)} ${"DUR".padEnd(durW)} ${"ROUNDS".padEnd(roundsW)} ${"OUTCOME".padEnd(outcomeW)} ${"TAGS".padEnd(tagsW)} PATH`,
	);
	console.log(
		`  ${"-".repeat(dateW)} ${"-".repeat(durW)} ${"-".repeat(roundsW)} ${"-".repeat(outcomeW)} ${"-".repeat(tagsW)} ${"-".repeat(pathW)}`,
	);
	for (const t of transcripts) {
		const date = new Date(t.mtimeMs).toISOString().slice(0, 19).replace("T", " ");
		const dur =
			t.meta.duration_seconds == null
				? "?"
				: t.meta.duration_seconds >= 60
					? `${Math.floor(t.meta.duration_seconds / 60)}m${t.meta.duration_seconds % 60}s`
					: `${t.meta.duration_seconds}s`;
		const rounds = t.meta.rounds == null ? "?" : String(t.meta.rounds);
		const outcome = t.meta.outcome ?? "?";
		const tags = (t.meta.tags ?? []).join(",");
		const relPath = path.relative(dir, t.path);
		console.log(
			`  ${date.padEnd(dateW)} ${dur.padEnd(durW)} ${rounds.padEnd(roundsW)} ${outcome.padEnd(outcomeW)} ${tags.padEnd(tagsW)} ${relPath}`,
		);
	}
}

async function runShow({ path: showPath, latest, transcriptsDir }) {
	let filePath = null;

	if (showPath && showPath !== true) {
		// Explicit path
		if (path.isAbsolute(showPath)) filePath = showPath;
		else filePath = path.join(process.cwd(), showPath);
	} else if (latest) {
		// Find newest in transcriptsDir (default: cwd)
		const dir = transcriptsDir ?? process.cwd();
		const transcripts = await findTranscripts(dir);
		if (transcripts.length === 0) {
			console.error(
				`No transcripts found in ${dir} (looking for roundtable-*.md)`,
			);
			process.exit(1);
		}
		filePath = transcripts[0].path;
	} else {
		console.error("Error: --show requires a path, or combine with --latest");
		console.error("  pi-roundtable --show /path/to/transcript.md");
		console.error("  pi-roundtable --show --latest");
		console.error(
			"  pi-roundtable --show --latest --transcripts-dir ~/roundtables",
		);
		process.exit(1);
	}

	let transcript;
	try {
		transcript = await readTranscript(filePath);
	} catch (err) {
		console.error(`Error reading ${filePath}: ${err.message}`);
		process.exit(1);
	}
	if (!transcript) {
		console.error(
			`${filePath} doesn't look like a roundtable transcript (no frontmatter or missing topic).`,
		);
		process.exit(1);
	}

	renderTranscript(transcript, { color: process.stdout.isTTY });
	console.error(`(from ${filePath})`);
}

/**
 * Search across all transcripts in `dir`. Substring (case-insensitive) match
 * against the topic + body by default, or restricted to a single frontmatter
 * field via `inField` (e.g. "topic", "outcome", "peers", "models").
 *
 * If `tagsFilter` is non-empty, only transcripts that have at least one of
 * those tags are considered.
 *
 * Output: one row per matching transcript, with the first matching line of
 * context. If `showAll` is true, every matching line is shown with line numbers.
 */
async function runSearch({ dir, term, inField, tagsFilter, showAll }) {
	const transcripts = await findTranscripts(dir);
	if (transcripts.length === 0) {
		console.log(`No transcripts in ${dir}`);
		return;
	}
	const lowerTerm = term.toLowerCase();
	const matches = [];

	for (const t of transcripts) {
		// Tag filter
		if (tagsFilter.length > 0) {
			const transcriptTags = new Set(t.meta.tags ?? []);
			const hasAny = tagsFilter.some((tag) => transcriptTags.has(tag));
			if (!hasAny) continue;
		}

		// Build the haystack. If inField is set, restrict to that field.
		const perLine = []; // [{ lineNo, text }] for context
		if (inField) {
			const field = inField.toLowerCase();
			if (field === "topic") {
				perLine.push({ lineNo: 1, text: t.meta.topic ?? "" });
			} else if (field === "outcome") {
				perLine.push({ lineNo: 1, text: t.meta.outcome ?? "" });
			} else if (field === "peers" || field === "models") {
				const items =
					field === "peers"
						? (t.meta.peers ?? [])
								.map((p) => `${p.name} (${p.role ?? "?"})`)
								.join(", ")
						: (t.meta.peers ?? []).map((p) => p.model ?? "").join(", ");
				perLine.push({ lineNo: 1, text: items });
			} else if (field === "tags") {
				const items = (t.meta.tags ?? []).join(", ");
				perLine.push({ lineNo: 1, text: items });
			} else {
				console.error(
					`Unknown --in field: ${field}. Valid: topic, outcome, peers, models, tags`,
				);
				process.exit(1);
			}
		} else {
			// Search topic + body, line by line
			perLine.push({ lineNo: 1, text: `(topic) ${t.meta.topic ?? ""}` });
			t.body.split("\n").forEach((line, idx) => {
				perLine.push({ lineNo: idx + 1, text: line });
			});
		}

		const lineHits = perLine.filter((l) =>
			l.text.toLowerCase().includes(lowerTerm),
		);
		if (lineHits.length === 0) continue;
		matches.push({ transcript: t, lineHits });
	}

	if (matches.length === 0) {
		console.log(
			`No matches for "${term}"${tagsFilter.length > 0 ? ` (tags: ${tagsFilter.join(", ")})` : ""} in ${dir}`,
		);
		return;
	}

	console.log(
		`Found ${matches.length} transcript${matches.length === 1 ? "" : "s"} matching "${term}"${tagsFilter.length > 0 ? ` (tags: ${tagsFilter.join(", ")})` : ""}:\n`,
	);
	for (const m of matches) {
		const relPath = path.relative(dir, m.transcript.path);
		const tags = m.transcript.meta.tags ?? [];
		const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
		console.log(`━━━ ${relPath}${tagStr}`);
		console.log(`    topic: ${m.transcript.meta.topic}`);
		const toShow = showAll ? m.lineHits : m.lineHits.slice(0, 2);
		for (const hit of toShow) {
			const trimmed =
				hit.text.length > 100 ? hit.text.slice(0, 100) + "..." : hit.text;
			console.log(`    L${hit.lineNo}: ${trimmed}`);
		}
		if (!showAll && m.lineHits.length > 2) {
			console.log(
				`    ... +${m.lineHits.length - 2} more line${m.lineHits.length - 2 === 1 ? "" : "s"} (use --all to show all)`,
			);
		}
		console.log("");
	}
}

// Handle update commands: check, update, rollback
async function handleUpdate({ args, installDir }) {
	const { spawn } = await import("node:child_process");
	const path = await import("node:path");
	const fs = await import("node:fs/promises");

	const updateScript = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"update.sh",
	);

	// Verify update script exists
	try {
		await fs.access(updateScript, fs.constants.X_OK);
	} catch {
		console.error(
			"Error: update script not found or not executable:",
			updateScript,
		);
		process.exit(1);
	}

	const scriptArgs = [];
	if (args.checkOnly) scriptArgs.push("check");
	else if (args.rollback) scriptArgs.push("rollback");
	else scriptArgs.push("update");

	if (args.channel) scriptArgs.push("--channel", args.channel);
	if (args.yes) scriptArgs.push("--yes");

	console.log("Running update script:", updateScript, scriptArgs.join(" "));

	return new Promise((resolve, reject) => {
		const proc = spawn(updateScript, scriptArgs, {
			stdio: ["inherit", "inherit", "inherit"],
			env: { ...process.env, PI_ROUNDTABLE_HOME: installDir },
		});
		proc.on("error", (err) => {
			console.error("Failed to spawn update script:", err.message);
			reject(err);
		});
		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else if (args.checkOnly && code === 1) {
				// check returns 1 when update available - that's not an error
				resolve();
			} else {
				console.error(`Update script exited with code ${code}`);
				process.exit(code);
			}
		});
	});
}

main().catch((err) => {
	console.error("Fatal:", err.message);
	process.exit(1);
});
