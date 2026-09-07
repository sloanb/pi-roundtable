import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * config.json must survive `pi-roundtable --update`. update.sh installs the
 * new release with `rsync -a --delete` (which deletes files absent from the
 * release tarball) and restores USER_FILES after. These tests pin both
 * mechanisms so user configuration can't be silently lost on update.
 */

const UPDATE_SH = join(import.meta.dirname ?? ".", "..", "lib", "update.sh");

const src = readFileSync(UPDATE_SH, "utf-8");

/** Extract the USER_FILES=( ... ) bash array literal. */
function userFiles(): string[] {
	const m = src.match(/USER_FILES=\(([\s\S]*?)\)/);
	if (!m) throw new Error("USER_FILES array not found in lib/update.sh");
	return m[1]
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/^"|"$/g, ""));
}

describe("update.sh preserves user configuration", () => {
	it("lists config.json in USER_FILES (backed up and restored)", () => {
		expect(userFiles()).toContain("config.json");
	});

	it("excludes config.json from the rsync --delete install step", () => {
		// The rsync call deletes dest files absent from the release; without
		// the exclude, a fresh release (which has no config.json) would wipe
		// the user's configuration before the restore step runs.
		const rsyncMatch = src.match(
			/rsync -a --delete[\s\S]*?"\$\{extract_dir\}\/"/,
		);
		expect(rsyncMatch).not.toBeNull();
		expect(rsyncMatch![0]).toContain("--exclude='config.json'");
	});

	it("still preserves the original user files (peers, presets.json)", () => {
		const files = userFiles();
		expect(files).toContain("peers");
		expect(files).toContain("presets.json");
	});
});
