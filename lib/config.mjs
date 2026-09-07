/**
 * config.mjs — global configuration for pi-roundtable.
 *
 * Lives at <install-dir>/config.json (usually ~/.pi-roundtable/config.json,
 * relocatable via PI_ROUNDTABLE_HOME). Survives `pi-roundtable --update`
 * (listed in update.sh's USER_FILES).
 *
 * Precedence for every setting: CLI flag → config.json → built-in default.
 * The file is optional: no file = built-in defaults exactly as before.
 *
 * Schema (all keys optional, snake_case):
 * {
 *   "defaults": {
 *     "preset": "design-review",          // used when --preset/--peers absent
 *     "transcripts_dir": "~/roundtables", // default dir for --transcripts-dir,
 *                                         //   --show --latest/--list/--search,
 *                                         //   and auto-named --save output
 *     "save": true,                        // always save transcripts
 *     "max_rounds": 12,
 *     "mode": "auto",                      // "auto" | "sequential" | "orchestrated"
 *     "channel": "stable",                 // update channel: "stable" | "prerelease"
 *     "tags": ["design"],                  // default transcript tags (merged with --tag)
 *     "validate_models": true,
 *     "model": { "researcher": "provider/model" },   // like --model, per peer
 *     "tools": { "researcher": ["read", "bash"] },    // like --tools, per peer
 *     "pretty": true, "compact": false, "timing": true, "thinking": true
 *   },
 *   "preset_aliases": { "design": "design-review" }
 * }
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Error loading or validating config.json. Message is user-facing. */
export class ConfigError extends Error {
	constructor(message) {
		super(message);
		this.name = "ConfigError";
	}
}

/**
 * Expand a leading "~" to the user's home directory.
 * "~" → home, "~/x" → home/x; anything else unchanged.
 */
export function expandHome(p) {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

/** Path of the config file for a given install directory. */
export function configFilePath(installDir) {
	return path.join(installDir, "config.json");
}

const isPlainObject = (v) =>
	typeof v === "object" && v !== null && !Array.isArray(v);

// Validators for known keys under "defaults".
const DEFAULTS_SCHEMA = {
	preset: (v) => typeof v === "string",
	transcripts_dir: (v) => typeof v === "string",
	save: (v) => typeof v === "boolean",
	max_rounds: (v) => Number.isInteger(v) && v > 0,
	mode: (v) => ["auto", "sequential", "orchestrated"].includes(v),
	channel: (v) => ["stable", "prerelease"].includes(v),
	tags: (v) => Array.isArray(v) && v.every((t) => typeof t === "string"),
	validate_models: (v) => typeof v === "boolean",
	model: (v) =>
		isPlainObject(v) && Object.values(v).every((m) => typeof m === "string"),
	tools: (v) =>
		isPlainObject(v) &&
		Object.values(v).every(
			(t) => Array.isArray(t) && t.every((x) => typeof x === "string"),
		),
	pretty: (v) => typeof v === "boolean",
	compact: (v) => typeof v === "boolean",
	timing: (v) => typeof v === "boolean",
	thinking: (v) => typeof v === "boolean",
};

// Fixed display order for --config output.
export const DEFAULTS_KEYS = Object.keys(DEFAULTS_SCHEMA);

/**
 * Load and validate config.json from an install directory.
 *
 * Returns { config, path, existed }:
 *   - config: validated config object (defaults/preset_aliases only), or null
 *     when no file exists
 *   - path: the file path examined
 *   - existed: whether the file was found
 *
 * Invalid JSON or a known key with a bad type throws ConfigError (fatal — the
 * user's configured intent must not silently no-op). Unknown keys are passed
 * to `warn` and ignored.
 */
export async function loadConfig({ installDir, warn = () => {} }) {
	const file = configFilePath(installDir);
	let raw;
	try {
		raw = await fs.readFile(file, "utf-8");
	} catch (err) {
		if (err.code === "ENOENT")
			return { config: null, path: file, existed: false };
		throw err;
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new ConfigError(`${file}: invalid JSON — ${err.message}`);
	}
	if (!isPlainObject(parsed)) {
		throw new ConfigError(`${file}: top level must be a JSON object`);
	}

	for (const key of Object.keys(parsed)) {
		if (key !== "defaults" && key !== "preset_aliases") {
			warn(`⚠ config: unknown top-level key "${key}" — ignored\n`);
		}
	}

	const config = {};
	if (parsed.defaults !== undefined) {
		if (!isPlainObject(parsed.defaults)) {
			throw new ConfigError(`${file}: "defaults" must be an object`);
		}
		for (const [key, value] of Object.entries(parsed.defaults)) {
			const check = DEFAULTS_SCHEMA[key];
			if (!check) {
				warn(`⚠ config: unknown key "defaults.${key}" — ignored\n`);
				continue;
			}
			if (!check(value)) {
				throw new ConfigError(
					`${file}: "defaults.${key}" has an invalid value: ${JSON.stringify(value)}`,
				);
			}
			(config.defaults ??= {})[key] = value;
		}
	}
	if (parsed.preset_aliases !== undefined) {
		if (!isPlainObject(parsed.preset_aliases)) {
			throw new ConfigError(`${file}: "preset_aliases" must be an object`);
		}
		for (const [alias, target] of Object.entries(parsed.preset_aliases)) {
			if (typeof target !== "string" || target === "") {
				throw new ConfigError(
					`${file}: preset alias "${alias}" must map to a preset name (string)`,
				);
			}
		}
		config.preset_aliases = parsed.preset_aliases;
	}

	// Expand "~" in transcripts_dir at load time so downstream consumers
	// never see an unexpanded path.
	if (config.defaults?.transcripts_dir) {
		config.defaults.transcripts_dir = expandHome(config.defaults.transcripts_dir);
	}

	return { config, path: file, existed: true };
}

/**
 * Resolve a preset name through preset_aliases. Returns the canonical preset
 * name, or throws ConfigError with an actionable message (listing available
 * presets and aliases) when neither a preset nor an alias matches.
 */
export function resolvePresetName({ name, presets, config }) {
	if (presets[name]) return name;
	const target = config?.preset_aliases?.[name];
	if (target) {
		if (presets[target]) return target;
		throw new ConfigError(
			`preset alias "${name}" points to preset "${target}", which doesn't exist. Fix "preset_aliases" in your config.`,
		);
	}
	const aliases = config?.preset_aliases ?? {};
	const aliasList = Object.keys(aliases);
	throw new ConfigError(
		`Unknown preset: ${name}. Available presets: ${Object.keys(presets).join(", ")}` +
			(aliasList.length > 0 ? `; aliases: ${aliasList.join(", ")}` : ""),
	);
}

/**
 * Build the --model / --tools CLI spec strings with config entries first and
 * CLI entries last, so CLI overrides win per peer name (the specs are parsed
 * sequentially and later name= pairs overwrite earlier ones).
 */
function mergeSpecString(configMap, cliSpec, toSpec) {
	if (!configMap || Object.keys(configMap).length === 0) return cliSpec;
	const configSpec = Object.entries(configMap)
		.map(([name, value]) => toSpec(name, value))
		.join(",");
	return cliSpec ? `${configSpec},${cliSpec}` : configSpec;
}

/**
 * Apply config defaults to parsed CLI args. Pure: returns a new args object.
 *
 * Tri-state CLI values (null until the flag is seen) let explicit flags win
 * over config; config wins over built-in defaults. `preset_aliases` and preset
 * existence are resolved later, where the preset table is available.
 */
export function resolveArgs(args, config) {
	const d = config?.defaults ?? {};
	const out = { ...args };

	if (out.maxRounds === null) out.maxRounds = d.max_rounds ?? 12;

	for (const [cfgKey, cliKey, builtin] of [
		["pretty", "pretty", true],
		["compact", "compact", false],
		["timing", "timing", true],
		["thinking", "thinking", true],
		["validate_models", "validateModels", true],
	]) {
		if (out[cliKey] === null) out[cliKey] = d[cfgKey] ?? builtin;
	}

	// save: null (unset) | "" (auto path) | explicit path. Config turns
	// "unset" into auto-save; an explicit --save always wins.
	if (out.save === null && d.save === true) out.save = "";

	// transcripts_dir: CLI flag > config > null (callers fall back to cwd).
	// expandHome makes the invariant hold regardless of how config was loaded.
	if (out.transcriptsDir === null && d.transcripts_dir) {
		out.transcriptsDir = expandHome(d.transcripts_dir);
	}

	// mode: explicit --mode wins; otherwise config; otherwise "auto"
	// (auto-detect orchestrated when an orchestrator peer is selected).
	if (!out.modeExplicit) out.mode = d.mode ?? "auto";

	// update channel: CLI flag wins (null or undefined when not passed)
	if (!out.channel && d.channel) out.channel = d.channel;

	// tags: out.tag stays CLI-only — it doubles as the --search --tag filter,
	// and config tags must never narrow a search. saveTags is what new
	// transcripts get stamped with: config tags + CLI tags, deduped.
	const cliTags = Array.isArray(out.tag) ? out.tag : [];
	out.saveTags = [...new Set([...(d.tags ?? []), ...cliTags])];

	// model/tools: config entries first, CLI entries last (CLI wins per peer)
	out.model = mergeSpecString(
		d.model,
		out.model,
		(name, model) => `${name}=${model}`,
	);
	out.tools = mergeSpecString(
		d.tools,
		out.tools,
		(name, tools) => `${name}=${tools.join(",")}`,
	);

	// default preset: only when neither --preset nor --peers was given
	if (!out.preset && !out.peers && d.preset) out.preset = d.preset;

	return out;
}

/**
 * Build the --config view: every known defaults key with its effective value
 * and provenance ("cli" | "file" | "default"), plus preset aliases.
 * `args` must be the PRE-resolution parsed args (tri-state intact).
 */
export function effectiveConfigView(args, config) {
	const d = config?.defaults ?? {};

	const cliSet = {
		preset: args.preset !== null,
		transcripts_dir: args.transcriptsDir !== null,
		save: args.save !== null,
		max_rounds: args.maxRounds !== null,
		mode: args.modeExplicit === true,
		channel: args.channel !== undefined,
		tags: Array.isArray(args.tag) && args.tag.length > 0,
		validate_models: args.validateModels !== null && args.validateModels !== true,
		model: args.model !== null,
		tools: args.tools !== null,
		pretty: args.pretty !== null,
		compact: args.compact !== null,
		timing: args.timing !== null,
		thinking: args.thinking !== null,
	};

	const builtin = {
		preset: "(all peers)",
		transcripts_dir: "(cwd)",
		save: false,
		max_rounds: 12,
		mode: "auto",
		channel: "stable",
		tags: [],
		validate_models: true,
		model: {},
		tools: {},
		pretty: true,
		compact: false,
		timing: true,
		thinking: true,
	};

	// Effective values = what resolveArgs would produce.
	const resolved = resolveArgs({ ...args, topic: null }, config);

	const rows = DEFAULTS_KEYS.map((key) => {
		const resolvedKey = {
			preset: "preset",
			transcripts_dir: "transcriptsDir",
			save: "save",
			max_rounds: "maxRounds",
			mode: "mode",
			channel: "channel",
			tags: "saveTags",
			validate_models: "validateModels",
			model: "model",
			tools: "tools",
			pretty: "pretty",
			compact: "compact",
			timing: "timing",
			thinking: "thinking",
		}[key];
		const value = resolved[resolvedKey];
		let source = "default";
		if (cliSet[key]) source = "cli";
		else if (d[key] !== undefined) source = "file";
		// save resolves to "" (auto-named save); display it as enabled.
		const displayValue = key === "save" && value === "" ? true : value;
		return {
			key,
			value:
				displayValue === null || displayValue === undefined
					? (builtin[key] ?? displayValue)
					: displayValue,
			source,
		};
	});

	return { rows, aliases: config?.preset_aliases ?? {} };
}

/**
 * Render the --config output: file location, per-key effective values with
 * provenance, and preset aliases. Returns the string; the caller prints it.
 */
export function renderConfigView({ args, config, path, existed }) {
	const { rows, aliases } = effectiveConfigView(args, config);
	const lines = [];
	lines.push("━━━ CONFIG ━━━");
	lines.push(
		`File:    ${path}${existed ? "" : "  (not found — using built-in defaults)"}`,
	);
	lines.push(`Format:  JSON. Docs: see "Configuration" in the README.`);
	lines.push("");
	const keyW = Math.max(...rows.map((r) => r.key.length), 16);
	for (const r of rows) {
		const value = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
		const shown = value.length > 48 ? `${value.slice(0, 45)}...` : value;
		lines.push(`  ${r.key.padEnd(keyW)} ${shown.padEnd(50)} (${r.source})`);
	}
	lines.push("");
	lines.push("preset_aliases:");
	const aliasEntries = Object.entries(aliases);
	if (aliasEntries.length === 0) {
		lines.push("  (none)");
	} else {
		for (const [alias, target] of aliasEntries) {
			lines.push(`  ${alias} → ${target}`);
		}
	}
	if (!existed) {
		lines.push("");
		lines.push(
			"Create the file above to change any default. Example in the README.",
		);
	}
	return lines.join("\n");
}
