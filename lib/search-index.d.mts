/**
 * Search-result snapshot: lets `--show #N` resolve numbers printed by a
 * previous `--search` across process invocations. See search-index.mjs.
 */

export interface SearchIndexEntry {
	/** Absolute path of the transcript. */
	path: string;
	/** Topic line, for confirmation display. */
	topic: string;
}

export interface SearchIndex {
	/** The search term. */
	term: string;
	/** Directory that was searched. */
	dir: string;
	/** When the search ran (epoch ms). */
	timestamp: number;
	/** Ordered result list, display order. */
	results: SearchIndexEntry[];
}

/** Path of the snapshot file for a given install directory. */
export declare function searchIndexPath(installDir: string): string;

/** Write the snapshot (called on every search, including empty results). */
export declare function writeSearchIndex(opts: {
	installDir: string;
	dir: string;
	term: string;
	results: SearchIndexEntry[];
}): Promise<void>;

/**
 * Read the snapshot. Returns null when missing or corrupt (both mean
 * "no results in memory", never a hard error).
 */
export declare function readSearchIndex(opts: {
	installDir: string;
}): Promise<SearchIndex | null>;

/** Successful resolveResultRef result. */
export interface ResolvedResultRef {
	ok: true;
	index: SearchIndex;
	entry: SearchIndexEntry;
	/** The 1-based result number. */
	number: number;
}

/** Failed resolveResultRef result (user-facing error message). */
export interface ResultRefError {
	ok: false;
	error: string;
}

/**
 * Resolve a `#N` reference against the last search: validates the format,
 * the snapshot, the range, and that the recorded file still exists.
 */
export declare function resolveResultRef(opts: {
	ref: string;
	installDir: string;
}): Promise<ResolvedResultRef | ResultRefError>;

/** Human-friendly age: "just now", "7m ago", "3h ago", "2d ago". */
export declare function agoLabel(timestamp: number, now?: number): string;
