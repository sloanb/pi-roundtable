import { describe, it, expect } from "vitest";
import {
	levenshtein,
	suggestCandidates,
	suggestFlag,
	formatSuggestions,
} from "../lib/suggest.mjs";
import {
	parseArgs,
	KNOWN_FLAGS,
	FLAGS_TAKING_VALUE,
} from "../lib/pi-roundtable.mjs";
import { resolvePresetName, ConfigError } from "../lib/config.mjs";

describe("suggest: levenshtein", () => {
	it("computes basic distances", () => {
		expect(levenshtein("same", "same")).toBe(0);
		expect(levenshtein("show", "sho")).toBe(1);
		expect(levenshtein("kitten", "sitting")).toBe(3);
		expect(levenshtein("", "abc")).toBe(3);
		expect(levenshtein("abc", "")).toBe(3);
	});
});

describe("suggest: suggestCandidates", () => {
	it("matches case-insensitively and returns the original spelling", () => {
		expect(suggestCandidates("SEQUENTIAL", ["sequential"])).toEqual([
			"sequential",
		]);
	});

	it("suggests near misses within distance 2", () => {
		expect(suggestCandidates("topc", ["topic", "tags", "peers"])).toEqual([
			"topic",
		]);
	});

	it("returns nothing when everything is too far", () => {
		expect(suggestCandidates("banana", ["topic", "peers"])).toEqual([]);
	});

	it("keeps tied best candidates together", () => {
		const got = suggestCandidates("sabe", ["save", "safe"]);
		expect(got).toContain("save");
		expect(got).toContain("safe");
	});

	it("returns only the exact match when one exists", () => {
		expect(suggestCandidates("tags", ["tag", "tags"])).toEqual(["tags"]);
	});
});

describe("suggest: suggestFlag", () => {
	it("treats a missing second dash as an exact body match", () => {
		expect(suggestFlag("-show", ["--show", "--save"])).toEqual(["--show"]);
	});

	it("suggests near-miss long flags", () => {
		expect(suggestFlag("--sav", ["--save", "--show"])).toEqual(["--save"]);
	});

	it("is case-insensitive", () => {
		expect(suggestFlag("--Show", ["--show"])).toEqual(["--show"]);
	});

	it("returns nothing for unrecognizable tokens", () => {
		expect(suggestFlag("--banana", ["--show", "--save"])).toEqual([]);
		expect(suggestFlag("-", ["--show"])).toEqual([]);
	});

	it("formats suggestions for error messages", () => {
		expect(formatSuggestions(["--show"])).toBe("'--show'");
		expect(formatSuggestions(["--sho", "--show"])).toBe("'--sho' or '--show'");
	});
});

describe("parseArgs: typo protection (guard + suggestions)", () => {
	it("errors on flag-shaped unknowns instead of using them as the topic", () => {
		// The exact failure mode: `pi-roundtable -show @1` used to launch a
		// roundtable about "-show" and silently drop "@1".
		const args = parseArgs(["node", "pi-roundtable", "-show", "@1"]);
		expect(args.error).toContain("Unknown option '-show'");
		expect(args.error).toContain("did you mean '--show'?");
		expect(args.topic).toBeNull();
		expect(args.warnings).toEqual([]);
	});

	it("suggests for near-miss long flags", () => {
		const args = parseArgs(["node", "pi-roundtable", "--sav"]);
		expect(args.error).toContain("Unknown option '--sav'");
		expect(args.error).toContain("'--save'");
	});

	it("is case-insensitive for flag suggestions", () => {
		const args = parseArgs(["node", "pi-roundtable", "--Show"]);
		expect(args.error).toContain("'--show'");
	});

	it("errors plainly when nothing is close", () => {
		const args = parseArgs(["node", "pi-roundtable", "--banana"]);
		expect(args.error).toContain("Unknown option '--banana'");
		expect(args.error).not.toContain("did you mean");
		expect(args.error).toContain("--help");
	});

	it("never errors on every registered flag (registry sync)", () => {
		// Per-flag dummy values where the flag is value-constrained.
		const dummies: Record<string, string> = {
			"--mode": "auto",
			"--channel": "stable",
			"--in": "topic",
			"--max-rounds": "5",
			"-r": "5",
		};
		for (const flag of KNOWN_FLAGS) {
			const value = FLAGS_TAKING_VALUE.has(flag) ? [dummies[flag] ?? "dummy"] : [];
			const args = parseArgs(["node", "pi-roundtable", flag, ...value]);
			expect(args.error, `flag ${flag} should parse cleanly`).toBeNull();
		}
	});

	it("supports -- as the end-of-options separator for dash-leading topics", () => {
		const args = parseArgs(["node", "pi-roundtable", "--", "-show", "@1"]);
		expect(args.error).toBeNull();
		expect(args.topic).toBe("-show");
		expect(args.warnings.map((w) => w.includes("@1"))).toContain(true);
	});

	it("--topic still accepts dash-leading values (escape hatch)", () => {
		const args = parseArgs(["node", "pi-roundtable", "--topic", "-show"]);
		expect(args.error).toBeNull();
		expect(args.topic).toBe("-show");
	});

	it("warns about ignored extra positionals", () => {
		const args = parseArgs(["node", "pi-roundtable", "hello", "world"]);
		expect(args.error).toBeNull();
		expect(args.topic).toBe("hello");
		expect(args.warnings).toHaveLength(1);
		expect(args.warnings[0]).toContain("'world'");
	});
});

describe("parseArgs: value suggestions", () => {
	it("suggests for a mistyped --mode", () => {
		const args = parseArgs(["node", "pi-roundtable", "--mode", "sequental"]);
		expect(args.error).toContain("Invalid value for --mode: 'sequental'");
		expect(args.error).toContain("did you mean 'sequential'?");
		expect(args.error).toContain("Valid: auto, sequential, orchestrated");
	});

	it("accepts all valid --mode values", () => {
		for (const mode of ["auto", "sequential", "orchestrated"]) {
			const args = parseArgs(["node", "pi-roundtable", "--mode", mode]);
			expect(args.error, `--mode ${mode}`).toBeNull();
			expect(args.mode).toBe(mode);
			expect(args.modeExplicit).toBe(true);
		}
	});

	it("suggests for a mistyped --in field", () => {
		const args = parseArgs([
			"node",
			"pi-roundtable",
			"--search",
			"x",
			"--in",
			"topc",
		]);
		expect(args.error).toContain("Invalid value for --in: 'topc'");
		expect(args.error).toContain("did you mean 'topic'?");
	});

	it("errors on invalid --channel with the valid list", () => {
		const args = parseArgs(["node", "pi-roundtable", "--channel", "nightly"]);
		expect(args.error).toContain("Invalid value for --channel: 'nightly'");
		expect(args.error).toContain("Valid: stable, prerelease");
	});
});

describe("resolvePresetName: suggestions", () => {
	const presets = {
		"design-review": { peers: ["researcher"] },
		"orchestrated-code-review": { peers: ["orchestrator"] },
	};
	const config = { preset_aliases: { design: "design-review" } };

	it("suggests the nearest preset for a typo", () => {
		try {
			resolvePresetName({ name: "design-revew", presets, config });
			throw new Error("expected resolvePresetName to throw");
		} catch (err) {
			if (!(err instanceof ConfigError)) throw err;
			expect(err.message).toContain("Unknown preset: design-revew");
			expect(err.message).toContain("Did you mean 'design-review'?");
		}
	});

	it("suggests aliases too", () => {
		try {
			resolvePresetName({ name: "desig", presets, config });
			throw new Error("expected resolvePresetName to throw");
		} catch (err) {
			if (!(err instanceof ConfigError)) throw err;
			expect(err.message).toContain("Did you mean 'design'?");
		}
	});
});
