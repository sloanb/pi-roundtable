/**
 * search-index.mjs — snapshot of the most recent --search result list.
 *
 * The CLI is sessionless: numbers printed by `--search` in one process must
 * be resolvable by a later `--show #N` invocation. This module is the bridge:
 * every search writes its ordered result list (absolute paths + topics) to
 * <install-dir>/.search-results.json, and `--show #N` reads it back.
 *
 * The snapshot is ephemeral by design: it is NOT in update.sh's USER_FILES,
 * so `--update` may clear it — losing it only means re-running --search.
 * Last search wins (concurrent terminals share one snapshot); the jump
 * confirmation line ("result N of M from search X, run Ym ago") makes any
 * staleness immediately visible.
 */

import fs from "node:fs/promises";
import path from "node:path";

/** Path of the search snapshot for a given install directory. */
export function searchIndexPath(installDir) {
	return path.join(installDir, ".search-results.json");
}

/**
 * Write the search snapshot. `results` is the ordered display list:
 * [{ path, topic }]. Called on every search — including empty-result
 * searches, so `--show #N` can report "the last search found 0 results"
 * instead of failing on a stale snapshot.
 */
export async function writeSearchIndex({ installDir, dir, term, results }) {
	const file = searchIndexPath(installDir);
	const payload = {
		term: term ?? "",
		dir: dir ?? "",
		timestamp: Date.now(),
		results: results.map((r) => ({
			path: r.path,
			topic: typeof r.topic === "string" ? r.topic : "",
		})),
	};
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
}

/**
 * Read the search snapshot. Returns null when missing or corrupt — both are
 * "no results in memory", never a hard error.
 */
export async function readSearchIndex({ installDir }) {
	const file = searchIndexPath(installDir);
	let raw;
	try {
		raw = await fs.readFile(file, "utf-8");
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.results)) {
			return null;
		}
		return {
			term: typeof parsed.term === "string" ? parsed.term : "",
			dir: typeof parsed.dir === "string" ? parsed.dir : "",
			timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : 0,
			results: parsed.results
				.filter((r) => r && typeof r === "object" && typeof r.path === "string")
				.map((r) => ({
					path: r.path,
					topic: typeof r.topic === "string" ? r.topic : "",
				})),
		};
	} catch {
		return null;
	}
}

/**
 * Resolve a `#N` result reference from the last search. Returns
 * { ok: true, index, entry, number } on success, or { ok: false, error }
 * with a user-facing message covering every failure mode:
 *   - malformed reference (not "#<digits>")
 *   - no snapshot on disk (no search run yet)
 *   - last search found 0 results
 *   - number out of range
 *   - the recorded file no longer exists (moved/deleted)
 */
export async function resolveResultRef({ ref, installDir }) {
	// Accept both sigils: "@N" is shell-safe unquoted ("#" starts a comment
	// in bash/zsh/fish when it begins a word, so "--show #2" never reaches
	// the CLI unless quoted); "#N" remains accepted for quoted/scripts use.
	const m = typeof ref === "string" ? ref.match(/^[@#](\d+)$/) : null;
	if (!m) {
		return {
			ok: false,
			error: `Invalid result reference "${ref}" — expected @N (e.g. --show @2), or #N when quoted.`,
		};
	}
	const number = parseInt(m[1], 10);

	const index = await readSearchIndex({ installDir });
	if (!index) {
		return {
			ok: false,
			error:
				"No search results in memory — run `pi-roundtable --search TERM` first, then `--show @N`.",
		};
	}
	if (index.results.length === 0) {
		return {
			ok: false,
			error: `The last search ("${index.term}", ${agoLabel(index.timestamp)}) found 0 results.`,
		};
	}
	if (number < 1 || number > index.results.length) {
		return {
			ok: false,
			error: `Result @${number} is out of range — the last search ("${index.term}", ${agoLabel(index.timestamp)}) returned ${index.results.length} result${index.results.length === 1 ? "" : "s"}.`,
		};
	}
	const entry = index.results[number - 1];
	try {
		await fs.access(entry.path);
	} catch {
		return {
			ok: false,
			error: `Result @${number} pointed to ${entry.path}${entry.topic ? ` (topic: ${entry.topic})` : ""}, which no longer exists — re-run --search to refresh.`,
		};
	}
	return { ok: true, index, entry, number };
}

/** Human-friendly age of a timestamp: "just now", "7m ago", "3h ago". */
export function agoLabel(timestamp, now = Date.now()) {
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
