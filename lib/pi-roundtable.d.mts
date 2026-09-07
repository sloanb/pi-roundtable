import type { PeerConfig } from "../types/peer.js";
import type { TranscriptMeta, Turn, Conclusion } from "../types/transcript.js";

export interface ParsedFrontmatter {
	name?: string;
	role?: string;
	model?: string;
	tools?: string[];
	body?: string;
	[key: string]: unknown;
}

export declare function parseFrontmatter(content: string): ParsedFrontmatter;

export declare function slugify(s: string): string;

/**
 * True when a topic is missing or only whitespace (guards against shell
 * quoting mistakes like a trailing space after a line-continuation
 * backslash).
 */
export declare function isBlankTopic(s: string | null | undefined): boolean;

export declare function checkModel(
	configured: string,
	available: Set<string> | string[] | null,
): "ok" | "unknown" | "no-catalog";

export interface RenderMarkdownOptions {
	topic: string;
	peers: Array<{ name: string; role: string; model?: string }>;
	rounds: number;
	consensus: boolean;
	transcript: Array<{ peer: string; role: string; text: string; round: number }>;
	startedAt: number;
	endedAt: number;
	tags?: Array<string>;
	conclusion?: Conclusion | null;
}

export declare function renderMarkdown(opts: RenderMarkdownOptions): string;

export declare function loadPeers(): Promise<PeerConfig[]>;

export declare function loadPresets(): Promise<
	Record<
		string,
		{ description?: string; peers: string[]; tools?: Record<string, string[]> }
	>
>;

export declare function parseArgs(argv: string[]): {
	topic: string | null;
	peers: string[] | null;
	preset: string | null;
	/** Tri-state: null until --max-rounds, so config can supply it. */
	maxRounds: number | null;
	listPresets: boolean;
	listModels: boolean;
	listTranscripts: boolean;
	show: string | boolean | null;
	latest: boolean;
	transcriptsDir: string | null;
	search: string | null;
	inField: string | null;
	tag: string[];
	help: boolean;
	save: string | null;
	model: string | null;
	dryRun: boolean;
	/** Tri-state: null until --validate-models/--no-validate-models. */
	validateModels: boolean | null;
	tools: string | null;
	update: boolean;
	checkOnly: boolean;
	rollback: boolean;
	yes: boolean;
	config: boolean;
	channel: string | null;
	/** Tri-state: null until --mode; resolved to "auto" by config defaults. */
	mode: string | null;
	/** Tri-state: null until --pretty/--no-pretty. */
	pretty: boolean | null;
	modeExplicit: boolean;
	/** Tri-state: null until --compact/--no-compact. */
	compact: boolean | null;
	/** Tri-state: null until --timing/--no-timing. */
	timing: boolean | null;
	/** Tri-state: null until --thinking/--no-thinking. */
	thinking: boolean | null;
	/** Fatal parse error (unknown option, invalid flag value) — set by parseArgs. */
	error: string | null;
	/** Non-fatal parse warnings (ignored extra positionals). */
	warnings: string[];
};

/** Every flag the CLI understands — feeds "did you mean" suggestions. */
export declare const KNOWN_FLAGS: string[];

/** Flags that consume the next token as a value (registry-sync test). */
export declare const FLAGS_TAKING_VALUE: Set<string>;

export declare function printDryRun(opts: {
	topic: string;
	peers: PeerConfig[];
	maxRounds: number;
	cwd: string;
	savePath: string | null;
}): void;

export declare function findTranscripts(dir: string): Promise<Array<any>>;
export declare function readTranscript(
	filePath: string,
): Promise<{ meta: any; body: string } | null>;
export declare function renderTranscript(
	opts: { meta: any; body: string },
	options?: { color?: boolean },
): string;
export declare function runListTranscripts(dir: string): Promise<void>;
export declare function runShow(options: {
	/** Path, a `#N` result reference from the last --search, or null. */
	path?: string | boolean | null;
	latest?: boolean;
	transcriptsDir?: string | null;
	/** Install dir holding the search snapshot; required for #N refs. */
	installDir?: string | null;
}): Promise<void>;
export declare function runSearch(options: {
	dir: string;
	term: string;
	inField?: string;
	tagsFilter?: Array<string>;
	showAll?: boolean;
	/** When given, the result list is snapshotted for `--show #N`. */
	installDir?: string | null;
}): Promise<void>;
export declare function handleUpdate(options: {
	args: any;
	installDir: string;
}): Promise<void>;

export declare function resolveTools(args: {
	selected: PeerConfig[];
	args: {
		tools: string | null;
		model: string | null;
		preset: string | null;
	};
	presets: Record<string, { tools?: Record<string, string[]> }>;
}): Record<string, string[]>;

/**
 * Parse a --tools CLI spec ("name=tool1,tool2,name=tool3") into a Map of
 * peer name -> tools array.
 */
export declare function parseToolsOverrides(
	spec: string | null | undefined,
): Map<string, string[]>;
