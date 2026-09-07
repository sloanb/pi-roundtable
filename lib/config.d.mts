/**
 * Global configuration for pi-roundtable (<install-dir>/config.json).
 * See config.mjs for the full schema documentation.
 */

/** Keys under "defaults" in config.json. All optional. */
export interface ConfigDefaults {
	/** Preset used when neither --preset nor --peers is given. */
	preset?: string;
	/** Default directory for transcripts (--transcripts-dir, --show --latest,
	 *  --list-transcripts, --search, and auto-named --save output). "~" expands. */
	transcripts_dir?: string;
	/** Always save transcripts (like always passing --save). */
	save?: boolean;
	/** Default --max-rounds. */
	max_rounds?: number;
	/** Default mode: "auto" (detect by orchestrator presence), "sequential",
	 *  or "orchestrated". */
	mode?: "auto" | "sequential" | "orchestrated";
	/** Update channel for --update/--check-only. */
	channel?: "stable" | "prerelease";
	/** Default transcript tags; merged with --tag (deduped). */
	tags?: string[];
	/** Default model validation (--validate-models). */
	validate_models?: boolean;
	/** Per-peer model overrides, like --model. CLI flags win per peer. */
	model?: Record<string, string>;
	/** Per-peer tool overrides, like --tools. CLI flags win per peer. */
	tools?: Record<string, string[]>;
	pretty?: boolean;
	compact?: boolean;
	timing?: boolean;
	thinking?: boolean;
}

/** Parsed contents of config.json. */
export interface GlobalConfig {
	defaults?: ConfigDefaults;
	preset_aliases?: Record<string, string>;
}

/** Result of loadConfig(). */
export interface LoadedConfig {
	/** Validated config, or null when no file exists. */
	config: GlobalConfig | null;
	/** The config file path examined. */
	path: string;
	/** Whether the file was found. */
	existed: boolean;
}

/** Fatal config load/validation error. Message is user-facing. */
export declare class ConfigError extends Error {
	constructor(message: string);
}

/** Parsed CLI args in tri-state form (null = not set on the CLI). */
export interface ResolvableArgs {
	topic: string | null;
	peers: string[] | null;
	preset: string | null;
	maxRounds: number | null;
	transcriptsDir: string | null;
	tag: string[];
	save: string | null;
	model: string | null;
	tools: string | null;
	mode: string | null;
	modeExplicit: boolean;
	/** Update channel flag, unset when not passed. */
	channel?: string | null;
	/** CLI --tag entries only (search filter); config tags never filter. */
	saveTags?: string[];
	pretty: boolean | null;
	compact: boolean | null;
	timing: boolean | null;
	thinking: boolean | null;
	validateModels: boolean | null;
	[key: string]: unknown;
}

/** Expand a leading "~" to the user's home directory. */
export declare function expandHome(p: string): string;

/** Path of the config file for a given install directory. */
export declare function configFilePath(installDir: string): string;

/** Known keys under "defaults", in --config display order. */
export declare const DEFAULTS_KEYS: string[];

/**
 * Load and validate config.json from an install directory. Unknown keys are
 * passed to `warn` and ignored; invalid JSON or bad types on known keys
 * throw ConfigError. Returns config: null when the file doesn't exist.
 */
export declare function loadConfig(opts: {
	installDir: string;
	warn?: (msg: string) => void;
}): Promise<LoadedConfig>;

/**
 * Resolve a preset name through preset_aliases. Returns the canonical preset
 * name, or throws ConfigError when neither a preset nor an alias matches.
 */
export declare function resolvePresetName(opts: {
	name: string;
	presets: Record<string, { description?: string; peers: string[] }>;
	config: GlobalConfig | null;
}): string;

/**
 * Apply config defaults to parsed CLI args (pure). Precedence per key:
 * CLI flag → config → built-in default.
 */
export declare function resolveArgs(
	args: ResolvableArgs,
	config: GlobalConfig | null,
): ResolvableArgs;

/** Provenance of a config row: where the effective value came from. */
export type ConfigSource = "cli" | "file" | "default";

/** One row of the --config output. */
export interface ConfigRow {
	key: string;
	value: unknown;
	source: ConfigSource;
}

/** The structured --config view. */
export interface ConfigView {
	rows: ConfigRow[];
	aliases: Record<string, string>;
}

/** Effective values + provenance for every known defaults key. */
export declare function effectiveConfigView(
	args: ResolvableArgs,
	config: GlobalConfig | null,
): ConfigView;

/** Render the --config output (returns the string; caller prints it). */
export declare function renderConfigView(opts: {
	args: ResolvableArgs;
	config: GlobalConfig | null;
	path: string;
	existed: boolean;
}): string;
