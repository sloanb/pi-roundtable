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
	maxRounds: number;
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
	validateModels: boolean;
	tools: string | null;
	update: boolean;
	checkOnly: boolean;
	rollback: boolean;
	yes: boolean;
	channel: string | null;
	mode: string;
	pretty: boolean;
	modeExplicit: boolean;
};

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
	path: string | boolean;
	latest: boolean;
	transcriptsDir: string;
}): Promise<void>;
export declare function runSearch(options: {
	dir: string;
	term: string;
	inField?: string;
	tagsFilter?: Array<string>;
	showAll?: boolean;
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
