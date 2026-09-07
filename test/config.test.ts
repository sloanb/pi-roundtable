import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadConfig,
	resolveArgs,
	resolvePresetName,
	effectiveConfigView,
	renderConfigView,
	expandHome,
	configFilePath,
	ConfigError,
} from "../lib/config.mjs";
import type { GlobalConfig } from "../lib/config.mjs";

const PRESETS = {
	"design-review": { peers: ["researcher", "critic", "implementer"] },
	"orchestrated-code-review": { peers: ["orchestrator", "implementer"] },
};

function makeInstallDir(configJson?: string) {
	const dir = mkdtempSync(join(tmpdir(), "rt-config-"));
	if (configJson !== undefined) {
		writeFileSync(join(dir, "config.json"), configJson);
	}
	return dir;
}

describe("config: expandHome", () => {
	it("expands ~ to the home directory", () => {
		expect(expandHome("~")).toBe(process.env.HOME ?? "");
	});
	it("expands ~/x", () => {
		expect(expandHome("~/x")).toBe(join(process.env.HOME ?? "", "x"));
	});
	it("leaves relative and absolute paths unchanged", () => {
		expect(expandHome("x/y")).toBe("x/y");
		expect(expandHome("/abs/x")).toBe("/abs/x");
	});
	it("does not expand mid-string tildes", () => {
		expect(expandHome("a~b")).toBe("a~b");
	});
});

describe("config: loadConfig", () => {
	it("returns null config when the file does not exist", async () => {
		const dir = makeInstallDir();
		try {
			const result = await loadConfig({ installDir: dir });
			expect(result.config).toBeNull();
			expect(result.existed).toBe(false);
			expect(result.path).toBe(join(dir, "config.json"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads a valid config and expands transcripts_dir", async () => {
		const dir = makeInstallDir(
			JSON.stringify({
				defaults: { transcripts_dir: "~/tables", max_rounds: 5 },
				preset_aliases: { design: "design-review" },
			}),
		);
		try {
			const result = await loadConfig({ installDir: dir });
			expect(result.existed).toBe(true);
			expect(result.config!.defaults!.transcripts_dir).toBe(
				join(process.env.HOME ?? "", "tables"),
			);
			expect(result.config!.defaults!.max_rounds).toBe(5);
			expect(result.config!.preset_aliases).toEqual({ design: "design-review" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws ConfigError on invalid JSON", async () => {
		const dir = makeInstallDir("{ not json");
		try {
			await expect(loadConfig({ installDir: dir })).rejects.toThrow(ConfigError);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns on unknown keys and ignores them", async () => {
		const dir = makeInstallDir(
			JSON.stringify({
				unknown_top: true,
				defaults: { max_rounds: 3, wat: 1 },
			}),
		);
		const warnings: string[] = [];
		try {
			const result = await loadConfig({
				installDir: dir,
				warn: (m) => warnings.push(m),
			});
			expect(warnings.some((m) => m.includes("unknown_top"))).toBe(true);
			expect(warnings.some((m) => m.includes("defaults.wat"))).toBe(true);
			expect(result.config!.defaults!.max_rounds).toBe(3);
			expect("wat" in (result.config!.defaults ?? {})).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws ConfigError on type violations for known keys", async () => {
		const bad = [
			{ max_rounds: 0 },
			{ max_rounds: "8" },
			{ mode: "sometimes" },
			{ channel: "nightly" },
			{ save: "yes" },
			{ tags: [1] },
			{ model: { researcher: 5 } },
			{ tools: { researcher: "read" } },
			{ pretty: "true" },
			{ preset: 7 },
		];
		for (const defaults of bad) {
			const dir = makeInstallDir(JSON.stringify({ defaults }));
			try {
				await expect(loadConfig({ installDir: dir })).rejects.toThrow(ConfigError);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("throws on a non-object top level or defaults", async () => {
		for (const raw of ["[]", '"hi"', '{"defaults": []}']) {
			const dir = makeInstallDir(raw);
			try {
				await expect(loadConfig({ installDir: dir })).rejects.toThrow(ConfigError);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});
});

describe("config: resolvePresetName", () => {
	const config = { preset_aliases: { design: "design-review", cr: "bogus" } };

	it("passes canonical preset names through", () => {
		expect(
			resolvePresetName({ name: "design-review", presets: PRESETS, config }),
		).toBe("design-review");
	});

	it("resolves aliases to their target preset", () => {
		expect(resolvePresetName({ name: "design", presets: PRESETS, config })).toBe(
			"design-review",
		);
	});

	it("errors when an alias points at a missing preset", () => {
		expect(() =>
			resolvePresetName({ name: "cr", presets: PRESETS, config }),
		).toThrow(/bogus/);
	});

	it("errors listing presets and aliases for unknown names", () => {
		expect(() =>
			resolvePresetName({ name: "nope", presets: PRESETS, config }),
		).toThrow(/design-review.*aliases.*design/s);
	});
});

/** Minimal tri-state args like parseArgs produces (pre-resolution). */
function baseArgs(overrides = {}) {
	return {
		topic: "t",
		peers: null,
		preset: null,
		maxRounds: null,
		transcriptsDir: null,
		tag: [],
		save: null,
		model: null,
		tools: null,
		mode: null,
		modeExplicit: false,
		channel: null,
		pretty: null,
		compact: null,
		timing: null,
		thinking: null,
		validateModels: null,
		...overrides,
	};
}

describe("config: resolveArgs", () => {
	it("applies built-in defaults with no config", () => {
		const out = resolveArgs(baseArgs(), null);
		expect(out.maxRounds).toBe(12);
		expect(out.pretty).toBe(true);
		expect(out.compact).toBe(false);
		expect(out.timing).toBe(true);
		expect(out.thinking).toBe(true);
		expect(out.validateModels).toBe(true);
		expect(out.mode).toBe("auto");
		expect(out.save).toBeNull();
		expect(out.transcriptsDir).toBeNull();
		expect(out.preset).toBeNull();
		expect(out.tag).toEqual([]);
	});

	it("applies config values when the CLI is silent", () => {
		const config: GlobalConfig = {
			defaults: {
				preset: "design-review",
				transcripts_dir: "~/tables",
				save: true,
				max_rounds: 5,
				mode: "sequential",
				channel: "prerelease",
				tags: ["design"],
				validate_models: false,
				pretty: false,
				compact: true,
				timing: false,
				thinking: false,
				model: { researcher: "p/m1" },
				tools: { researcher: ["read", "bash"] },
			},
		};
		const out = resolveArgs(baseArgs(), config);
		expect(out.preset).toBe("design-review");
		expect(out.transcriptsDir).toBe(join(process.env.HOME ?? "", "tables"));
		expect(out.save).toBe(""); // auto-save
		expect(out.maxRounds).toBe(5);
		expect(out.mode).toBe("sequential");
		expect(out.channel).toBe("prerelease");
		expect(out.tag).toEqual([]); // CLI-only: no config leak into search filters
		expect(out.saveTags).toEqual(["design"]); // save stamps config tags
		expect(out.validateModels).toBe(false);
		expect(out.pretty).toBe(false);
		expect(out.compact).toBe(true);
		expect(out.timing).toBe(false);
		expect(out.thinking).toBe(false);
		expect(out.model).toBe("researcher=p/m1");
		expect(out.tools).toBe("researcher=read,bash");
	});

	it("CLI flags beat config values", () => {
		const config: GlobalConfig = {
			defaults: {
				max_rounds: 5,
				mode: "sequential",
				pretty: false,
				channel: "stable",
			},
		};
		const out = resolveArgs(
			baseArgs({
				maxRounds: 9,
				mode: "orchestrated",
				modeExplicit: true,
				pretty: true,
				channel: "prerelease",
			}),
			config,
		);
		expect(out.maxRounds).toBe(9);
		expect(out.mode).toBe("orchestrated");
		expect(out.modeExplicit).toBe(true);
		expect(out.pretty).toBe(true);
		expect(out.channel).toBe("prerelease");
	});

	it("--peers suppresses the default preset from config", () => {
		const config = { defaults: { preset: "design-review" } };
		const out = resolveArgs(baseArgs({ peers: ["researcher"] }), config);
		expect(out.preset).toBeNull();
	});

	it("merges config model/tools under CLI spec strings with CLI winning per peer", () => {
		const config = {
			defaults: {
				model: { researcher: "p/config-m", critic: "p/critic-m" },
				tools: { researcher: ["read"], critic: ["read", "bash"] },
			},
		};
		const out = resolveArgs(
			baseArgs({ model: "researcher=p/cli-m", tools: "researcher=cli_tool" }),
			config,
		);
		// Config entries first, CLI entries last → CLI wins per name.
		expect(out.model).toBe(
			"researcher=p/config-m,critic=p/critic-m,researcher=p/cli-m",
		);
		expect(out.tools).toBe(
			"researcher=read,critic=read,bash,researcher=cli_tool",
		);
	});

	it("stamps saveTags with config+CLI tags but keeps tag CLI-only (search filter)", () => {
		const config: GlobalConfig = { defaults: { tags: ["design", "shared"] } };
		const out = resolveArgs(baseArgs({ tag: ["shared", "cli"] }), config);
		// --search --tag filtering uses args.tag: explicit CLI tags only.
		expect(out.tag).toEqual(["shared", "cli"]);
		// Saving stamps the merge: config tags + CLI tags, deduped.
		expect(out.saveTags).toEqual(["design", "shared", "cli"]);
	});

	it("keeps explicit --save PATH untouched and config save does not override", () => {
		const config = { defaults: { save: true } };
		const out = resolveArgs(baseArgs({ save: "out.md" }), config);
		expect(out.save).toBe("out.md");
	});
});

describe("config: --config view", () => {
	it("reports provenance per key: cli / file / default", () => {
		const config: GlobalConfig = {
			defaults: { max_rounds: 5, save: true },
			preset_aliases: { design: "design-review" },
		};
		const args = baseArgs({ pretty: false });
		const view = effectiveConfigView(args, config);
		const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r]));
		expect(byKey.max_rounds).toEqual({
			key: "max_rounds",
			value: 5,
			source: "file",
		});
		expect(byKey.pretty.source).toBe("cli");
		expect(byKey.pretty.value).toBe(false);
		expect(byKey.compact.source).toBe("default");
		expect(byKey.mode).toEqual({ key: "mode", value: "auto", source: "default" });
		// save resolves to "" (auto-name); the view displays it as enabled
		expect(byKey.save).toEqual({ key: "save", value: true, source: "file" });
		expect(view.aliases).toEqual({ design: "design-review" });
	});

	it("renderConfigView includes the file path, rows, and aliases", () => {
		const config = {
			defaults: { max_rounds: 5 },
			preset_aliases: { design: "design-review" },
		};
		const text = renderConfigView({
			args: baseArgs(),
			config,
			path: "/x/config.json",
			existed: true,
		});
		expect(text).toContain("━━━ CONFIG ━━━");
		expect(text).toContain("/x/config.json");
		expect(text).toContain("max_rounds");
		expect(text).toContain("(file)");
		expect(text).toContain("design → design-review");
	});

	it("renderConfigView notes a missing file and points to the README", () => {
		const text = renderConfigView({
			args: baseArgs(),
			config: null,
			path: "/x/config.json",
			existed: false,
		});
		expect(text).toContain("not found");
		expect(text).toContain("(default)");
		expect(text).toContain("README");
	});
});

describe("config: configFilePath", () => {
	it("is config.json under the install dir", () => {
		expect(configFilePath("/opt/rt")).toBe("/opt/rt/config.json");
	});
});
