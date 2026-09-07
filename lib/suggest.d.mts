/**
 * "Did you mean" suggestions for mistyped CLI flags and values.
 * See suggest.mjs.
 */

/** Levenshtein edit distance (case-sensitive; callers normalize as needed). */
export declare function levenshtein(a: string, b: string): number;

/**
 * Suggest candidates for a mistyped input (case-insensitive). Returns the
 * original spellings, best-first, ties kept together (max limit). An exact
 * normalized match returns just that candidate.
 */
export declare function suggestCandidates(
 input: string,
 candidates: Array<string>,
 opts?: { maxDistance?: number; limit?: number },
): Array<string>;

/**
 * Suggest known flags for a mistyped one. Leading dashes are normalized on
 * both sides, so "-show" matches "--show" exactly (missing-dash typos get
 * near-certain suggestions). Returns up to 3 flags, best-first.
 */
export declare function suggestFlag(
 token: string,
 knownFlags: Array<string>,
): Array<string>;

/** Format suggestions for an error message: `'--show'` or `'--a' or '--b'`. */
export declare function formatSuggestions(suggestions: Array<string>): string;
