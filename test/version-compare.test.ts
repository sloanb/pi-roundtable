import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Tests for version_compare in lib/update.sh.
 *
 * update.sh is a self-executing CLI script (it runs main() at the bottom), so
 * it can't be sourced directly. Instead, extract just the version_compare
 * function, append a driver that runs a case table, and execute it with
 * bash. This exercises the exact production code path — not a re-implementation.
 */

const UPDATE_SH = join(import.meta.dirname ?? ".", "..", "lib", "update.sh");

function extractVersionCompare(): string {
	const src = readFileSync(UPDATE_SH, "utf-8");
	const m = src.match(
		/# Semantic version comparison[\s\S]*?\nversion_compare\(\) \{[\s\S]*?\n\}\n/,
	);
	if (!m) throw new Error("version_compare not found in lib/update.sh");
	return m[0];
}

// [v1, v2, expected] — expected: 0 equal, 1 v1>v2, 2 v1<v2
const CASES: Array<[string, string, number]> = [
	// plain versions (pre-existing behavior must be preserved)
	["0.3.0", "0.3.0", 0],
	["0.3.0", "0.4.0", 2],
	["0.4.0", "0.3.0", 1],
	["0.10.0", "0.9.9", 1], // numeric, not lexical ("10" > "9")
	["0.4", "0.4.0", 0], // missing segments fill with zeros
	["v0.4.0", "0.4.0", 0], // leading v stripped
	// prerelease ordering (semver: prerelease < its own release)
	["0.4.0-beta.1", "0.4.0-beta.1", 0],
	["0.3.0", "0.4.0-beta.1", 2], // stable user sees beta as newer
	["0.4.0-beta.1", "0.3.0", 1],
	["0.4.0-beta.1", "0.4.0", 2], // graduation: beta user gets stable 0.4.0
	["0.4.0", "0.4.0-beta.1", 1],
	["0.4.0-beta.1", "0.4.0-beta.2", 2],
	["0.4.0-beta.2", "0.4.0-beta.1", 1],
	["0.4.0-beta.1", "0.4.1-beta.1", 2], // core beats suffix
	["0.4.0-beta.1", "0.4.0-rc.1", 2], // lexical suffix: beta < rc
	["v0.4.0-beta.1", "0.4.0-beta.1", 0],
	["0.4.0-beta.10", "0.4.0-beta.9", 1], // numeric suffix compare
];

describe("update.sh version_compare", () => {
	let scriptPath: string;
	let tmpDir: string;

	beforeAll(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "vc-test-"));
		scriptPath = join(tmpDir, "vc.sh");
		const driver = `
while IFS='|' read -r a b want; do
	version_compare "$a" "$b"
	got=$?
	echo "$a|$b|$want|$got"
done <<'EOF'
${CASES.map(([a, b, want]) => `${a}|${b}|${want}`).join("\n")}
EOF
`;
		writeFileSync(scriptPath, extractVersionCompare() + "\n" + driver);
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("handles plain, prerelease, and graduation orderings", () => {
		const out = execFileSync("bash", [scriptPath], { encoding: "utf-8" });
		const lines = out.trim().split("\n");
		expect(lines).toHaveLength(CASES.length);
		const failures: string[] = [];
		for (const line of lines) {
			const [a, b, want, got] = line.split("|");
			if (Number(want) !== Number(got)) {
				failures.push(
					`version_compare(${JSON.stringify(a)}, ${JSON.stringify(b)}): ` +
						`expected ${want}, got ${got}`,
				);
			}
		}
		expect(failures).toEqual([]);
	});

	it("stays in sync with lib/update.sh (extraction guard)", () => {
		// If version_compare is renamed or removed, extraction throws and this
		// suite fails loudly instead of silently testing nothing.
		expect(extractVersionCompare()).toContain("version_compare()");
	});
});
