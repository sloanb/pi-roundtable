/**
 * suggest.mjs — "did you mean" suggestions for mistyped CLI flags and values.
 *
 * Zero dependencies: a hand-rolled Levenshtein distance plus candidate
 * ranking. Suggestions are hints only — the caller decides how strict to be
 * (unknown flag-shaped options are fatal in parseArgs; unknown preset names
 * get suggestions in their existing error).
 */

/**
 * Levenshtein edit distance between two strings (case-sensitive; callers
 * normalize as needed).
 */
export function levenshtein(a, b) {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const curr = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		prev = curr;
	}
	return prev[b.length];
}

/**
 * Suggest candidates for a mistyped input. Case-insensitive. Returns the
 * ORIGINAL candidate spellings, best-first, tied candidates kept together
 * (max `limit`). An exact normalized match returns just that candidate.
 */
export function suggestCandidates(
	input,
	candidates,
	{ maxDistance = 2, limit = 3 } = {},
) {
	const needle = String(input).toLowerCase();
	const scored = [];
	for (const candidate of candidates) {
		const distance = levenshtein(needle, String(candidate).toLowerCase());
		if (distance <= maxDistance) scored.push({ candidate, distance });
	}
	if (scored.length === 0) return [];
	scored.sort(
		(x, y) => x.distance - y.distance || x.candidate.length - y.candidate.length,
	);
	const best = scored[0].distance;
	return scored
		.filter((s) => s.distance === best)
		.slice(0, limit)
		.map((s) => s.candidate);
}

/** Strip leading dashes for flag-body comparison ("-show" → "show"). */
const flagBody = (f) => f.replace(/^-+/, "").toLowerCase();

/**
 * Suggest known flags for a mistyped one. Dash counts are normalized on both
 * sides, so a missing second dash ("-show" vs "--show") is an exact body
 * match — a near-certain suggestion. Returns up to 3 flags, best-first.
 */
export function suggestFlag(token, knownFlags) {
	const body = flagBody(String(token));
	if (body.length === 0) return []; // bare "-" / "---": nothing sensible
	const scored = [];
	for (const flag of knownFlags) {
		const distance = levenshtein(body, flagBody(flag));
		if (distance <= 2) scored.push({ flag, distance });
	}
	if (scored.length === 0) return [];
	scored.sort(
		(x, y) => x.distance - y.distance || x.flag.length - y.flag.length,
	);
	const best = scored[0].distance;
	return scored
		.filter((s) => s.distance === best)
		.slice(0, 3)
		.map((s) => s.flag);
}

/**
 * Format a suggestion list for an error message: `'--show'` or
 * `'--sho' or '--show'`.
 */
export function formatSuggestions(suggestions) {
	return suggestions.map((s) => `'${s}'`).join(" or ");
}
