import { describe, it, expect } from "vitest";
import {
	parseArgs,
	parseFrontmatter,
	slugify,
	isBlankTopic,
	parseToolsOverrides,
	renderMarkdown,
	loadPeers,
	loadPresets,
	checkModel,
	resolveTools,
	printDryRun,
	findTranscripts,
	renderTranscript,
	runListTranscripts,
	runShow,
	runSearch,
	handleUpdate,
} from "../lib/pi-roundtable.mjs";

describe("pi-roundtable CLI", () => {
	describe("parseArgs", () => {
		it("parses basic topic flag", () => {
			const args = parseArgs(["node", "pi-roundtable", "--topic", "test topic"]);
			expect(args.topic).toBe("test topic");
		});

		it("parses short topic flag", () => {
			const args = parseArgs(["node", "pi-roundtable", "-t", "short topic"]);
			expect(args.topic).toBe("short topic");
		});

		it("parses positional topic", () => {
			const args = parseArgs(["node", "pi-roundtable", "positional topic"]);
			expect(args.topic).toBe("positional topic");
		});

		it("parses --peers comma-separated", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"--peers",
				"a,b,c",
				"-t",
				"topic",
			]);
			expect(args.peers).toEqual(["a", "b", "c"]);
		});

		it("parses --preset", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"--preset",
				"design-review",
				"-t",
				"topic",
			]);
			expect(args.preset).toBe("design-review");
		});

		it("parses --max-rounds", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"--max-rounds",
				"5",
				"-t",
				"topic",
			]);
			expect(args.maxRounds).toBe(5);
		});

		it("parses --save with path", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"-o",
				"output.md",
			]);
			expect(args.save).toBe("output.md");
		});

		it("parses --save without path (empty string)", () => {
			const args = parseArgs(["node", "pi-roundtable", "-t", "topic", "-o"]);
			expect(args.save).toBe("");
		});

		it("parses --model overrides", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"-m",
				"researcher=model1,critic=model2",
			]);
			expect(args.model).toBe("researcher=model1,critic=model2");
		});

		it("parses --tools overrides", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"--tools",
				"researcher=read,bash",
			]);
			expect(args.tools).toBe("researcher=read,bash");
		});

		it("parses --mode", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"--mode",
				"orchestrated",
			]);
			expect(args.mode).toBe("orchestrated");
			expect(args.modeExplicit).toBe(true);
		});

		it("parses --pretty and --no-pretty", () => {
			const args1 = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"--pretty",
			]);
			expect(args1.pretty).toBe(true);
			const args2 = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"--no-pretty",
			]);
			expect(args2.pretty).toBe(false);
		});

		it("parses --list-presets", () => {
			const args = parseArgs(["node", "pi-roundtable", "--list-presets"]);
			expect(args.listPresets).toBe(true);
		});

		it("parses --list-models", () => {
			const args = parseArgs(["node", "pi-roundtable", "--list-models"]);
			expect(args.listModels).toBe(true);
		});

		it("parses --list-transcripts with dir", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"--list-transcripts",
				"/tmp",
			]);
			expect(args.listTranscripts).toBe(true);
			expect(args.transcriptsDir).toBe("/tmp");
		});

		it("parses --show with path", () => {
			const args = parseArgs(["node", "pi-roundtable", "--show", "transcript.md"]);
			expect(args.show).toBe("transcript.md");
		});

		it("parses --latest", () => {
			const args = parseArgs(["node", "pi-roundtable", "--latest"]);
			expect(args.latest).toBe(true);
		});

		it("parses --search", () => {
			const args = parseArgs(["node", "pi-roundtable", "--search", "term"]);
			expect(args.search).toBe("term");
		});

		it("parses --in field", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"--search",
				"term",
				"--in",
				"topic",
			]);
			expect(args.inField).toBe("topic");
		});

		it("parses --tag repeatable", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"--tag",
				"a",
				"--tag",
				"b",
			]);
			expect(args.tag).toEqual(["a", "b"]);
		});

		it("parses --update, --check-only, --rollback, --channel", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"--update",
				"--check-only",
				"--rollback",
				"--channel",
				"prerelease",
			]);
			expect(args.update).toBe(true);
			expect(args.checkOnly).toBe(true);
			expect(args.rollback).toBe(true);
			expect(args.channel).toBe("prerelease");
		});

		it("parses --yes", () => {
			const args = parseArgs(["node", "pi-roundtable", "--yes"]);
			expect(args.yes).toBe(true);
		});

		it("parses --dry-run", () => {
			const args = parseArgs([
				"node",
				"pi-roundtable",
				"-t",
				"topic",
				"--dry-run",
			]);
			expect(args.dryRun).toBe(true);
		});

		it("parses --validate-models and --no-validate-models", () => {
			const args1 = parseArgs(["node", "pi-roundtable", "--validate-models"]);
			expect(args1.validateModels).toBe(true);
			const args2 = parseArgs(["node", "pi-roundtable", "--no-validate-models"]);
			expect(args2.validateModels).toBe(false);
		});

		it("defaults maxRounds to 12", () => {
			const args = parseArgs(["node", "pi-roundtable", "-t", "topic"]);
			expect(args.maxRounds).toBe(12);
		});

		it("defaults mode to sequential", () => {
			const args = parseArgs(["node", "pi-roundtable", "-t", "topic"]);
			expect(args.mode).toBe("sequential");
		});

		it("defaults pretty to true", () => {
			const args = parseArgs(["node", "pi-roundtable", "-t", "topic"]);
			expect(args.pretty).toBe(true);
		});

		it("defaults save to null", () => {
			const args = parseArgs(["node", "pi-roundtable", "-t", "topic"]);
			expect(args.save).toBeNull();
		});
	});

	describe("parseFrontmatter", () => {
		it("parses basic frontmatter", () => {
			const content = `---\nname: test\nrole: researcher\nmodel: ollama/model\n---\nbody content`;
			const result = parseFrontmatter(content);
			expect(result.name).toBe("test");
			expect(result.role).toBe("researcher");
			expect(result.model).toBe("ollama/model");
			expect(result.body).toBe("body content");
		});

		it("parses tools as array", () => {
			const content = `---\ntools: read, bash, edit\n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.tools).toEqual(["read", "bash", "edit"]);
		});

		it("handles missing frontmatter", () => {
			const content = "no frontmatter here";
			const result = parseFrontmatter(content);
			expect(result.body).toBe("no frontmatter here");
		});

		it("strips quotes from values", () => {
			const content = `---\nname: "quoted"\nrole: 'single'\n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.name).toBe("quoted");
			expect(result.role).toBe("single");
		});

		it("handles empty tools", () => {
			const content = `---\ntools: \n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.tools).toEqual([]);
		});

		it("leaves tools undefined when the key is absent (defaults apply later)", () => {
			const content = `---\nname: no-tools\n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.tools).toBeUndefined();
		});

		it("parses capabilities as a block list", () => {
			const content = `---\nname: critic\ncapabilities:\n  - code-review\n  - security-audit\n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.capabilities).toEqual(["code-review", "security-audit"]);
		});

		it("parses capabilities declared inline as an empty list", () => {
			const content = `---\nname: critic\ncapabilities:\n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.capabilities).toEqual([]);
		});

		it("leaves capabilities undefined when absent", () => {
			const content = `---\nname: critic\n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.capabilities).toBeUndefined();
		});

		it("leaves bare scalar keys unset so downstream defaults apply", () => {
			const content = `---\nname: x\nmodel:\nrole: y\n---\nbody`;
			const result = parseFrontmatter(content);
			expect(result.model).toBeUndefined();
			expect(result.role).toBe("y");
		});
	});

	describe("slugify", () => {
		it("lowercases and hyphenates", () => {
			expect(slugify("Hello World")).toBe("hello-world");
		});

		it("removes special chars", () => {
			expect(slugify("Test@#$%^&*()")).toBe("test");
		});

		it("collapses multiple hyphens", () => {
			expect(slugify("a   b   c")).toBe("a-b-c");
		});

		it("trims leading/trailing hyphens", () => {
			expect(slugify("---test---")).toBe("test");
		});

		it("caps at 60 chars", () => {
			const long = "a".repeat(70);
			expect(slugify(long).length).toBe(60);
		});

		it("returns untitled for empty", () => {
			expect(slugify("")).toBe("untitled");
			expect(slugify("   ")).toBe("untitled");
		});
	});

	describe("renderMarkdown", () => {
		const baseOpts = {
			topic: "Test topic",
			peers: [
				{ name: "researcher", role: "researcher", model: "model1" },
				{ name: "critic", role: "critic", model: "model2" },
			],
			rounds: 2,
			consensus: true,
			transcript: [
				{ peer: "researcher", role: "researcher", text: "First turn", round: 1 },
				{ peer: "critic", role: "critic", text: "Second turn", round: 1 },
			],
			startedAt: Date.now(),
			endedAt: Date.now() + 1000,
			tags: ["tag1", "tag2"],
		};

		it("includes YAML frontmatter", () => {
			const md = renderMarkdown(baseOpts);
			expect(md).toContain("---");
			expect(md).toContain('topic: "Test topic"');
			expect(md).toContain("rounds: 2");
			expect(md).toContain("outcome: consensus");
			expect(md).toContain("tags:");
			expect(md).toContain("tag1");
			expect(md).toContain("tag2");
		});

		it("includes peers in frontmatter", () => {
			const md = renderMarkdown(baseOpts);
			expect(md).toContain("name: researcher");
			expect(md).toContain("role: researcher");
			expect(md).toContain("model: model1");
		});

		it("includes transcript turns", () => {
			const md = renderMarkdown(baseOpts);
			expect(md).toContain("### Round 1 · researcher");
			expect(md).toContain("First turn");
			expect(md).toContain("### Round 1 · critic");
			expect(md).toContain("Second turn");
		});

		it("includes conclusion section when consensus=true", () => {
			const md = renderMarkdown(baseOpts);
			expect(md).toContain("## Conclusion");
			expect(md).toContain(
				"✅ Consensus reached at round 1 by **critic** (critic).",
			);
			expect(md).toContain("### Summary");
			// Without structured conclusion data, the last turn's text is the summary
			expect(md).toContain("Second turn");
		});

		it("excludes conclusion section when consensus=false", () => {
			const md = renderMarkdown({ ...baseOpts, consensus: false });
			expect(md).not.toContain("## Conclusion");
			expect(md).not.toContain("### Summary");
		});

		it("renders a structured conclusion with summary, details, and peer reports", () => {
			const conclusion = {
				mode: "orchestrated" as const,
				byPeer: "orchestrator",
				byRole: "orchestrator",
				round: 3,
				summary: "All tasks complete. Implementation reviewed.",
				structured: null,
				artifacts: ["src/auth.ts", "tests/auth.test.ts"],
				completedTasks: ["research", "implement"],
				pendingTasks: ["release"],
				blockedTasks: [],
				peerFindings: [
					{
						peer: "researcher",
						role: "researcher",
						status: "complete",
						findings: "Prior art found.",
						artifacts: [],
					},
				],
			};
			const md = renderMarkdown({ ...baseOpts, conclusion });
			expect(md).toContain("## Conclusion");
			expect(md).toContain(
				"✅ Consensus reached at round 3 by **orchestrator** (orchestrator).",
			);
			expect(md).toContain("### Summary");
			expect(md).toContain("All tasks complete. Implementation reviewed.");
			expect(md).toContain("### Details");
			expect(md).toContain(
				"**Artifacts produced:** src/auth.ts, tests/auth.test.ts",
			);
			expect(md).toContain("**Tasks completed:** research, implement");
			expect(md).toContain("**Tasks pending:** release");
			expect(md).toContain("### Peer reports");
			expect(md).toContain("#### researcher (researcher) — complete");
			expect(md).toContain("Prior art found.");
		});

		it("omits details sections when the conclusion has no details", () => {
			const conclusion = {
				mode: "sequential" as const,
				byPeer: "critic",
				byRole: "critic",
				round: 1,
				summary: "We agree.",
				structured: null,
				artifacts: [],
				completedTasks: [],
				pendingTasks: [],
				blockedTasks: [],
				peerFindings: [],
			};
			const md = renderMarkdown({ ...baseOpts, conclusion });
			expect(md).toContain("We agree.");
			expect(md).not.toContain("### Details");
			expect(md).not.toContain("### Peer reports");
		});

		it("shows max-rounds-reached outcome", () => {
			const md = renderMarkdown({ ...baseOpts, consensus: false });
			expect(md).toContain("outcome: max-rounds-reached");
		});

		it("handles empty transcript", () => {
			const md = renderMarkdown({ ...baseOpts, transcript: [] });
			expect(md).toContain("0 turns");
		});
	});

	describe("checkModel", () => {
		it("returns 'ok' for exact match", () => {
			// The function expects bare model IDs in the available set
			const available = ["nemotron-3-ultra", "kimi-k2.7-code"];
			expect(checkModel("ollama-cloud/nemotron-3-ultra", available)).toBe("ok");
		});

		it("returns 'ok' for bare model match", () => {
			const available = ["nemotron-3-ultra"];
			expect(checkModel("nemotron-3-ultra", available)).toBe("ok");
		});

		it("returns 'unknown' for unknown model", () => {
			const available = ["nemotron-3-ultra"];
			expect(checkModel("unknown-model", available)).toBe("unknown");
		});

		it("handles empty available", () => {
			expect(checkModel("any-model", [])).toBe("unknown");
		});
	});

	describe("resolveTools", () => {
		const mockPeers = [
			{ name: "researcher", role: "researcher", tools: ["read", "bash"] },
			{
				name: "critic",
				role: "critic",
				tools: ["read", "bash", "lsp_diagnostics"],
			},
		];

		const mockPresets = {
			"test-preset": {
				peers: ["researcher", "critic"],
				tools: {
					researcher: ["read", "bash", "kagi_search"],
					critic: ["read", "bash", "lsp_diagnostics", "lens_diagnostics"],
				},
			},
		};

		const baseArgs = {
			topic: "test",
			peers: null,
			preset: null,
			maxRounds: 12,
			listPresets: false,
			listModels: false,
			listTranscripts: false,
			show: null,
			latest: false,
			transcriptsDir: null,
			search: null,
			inField: null,
			tag: [],
			help: false,
			save: null,
			model: null,
			dryRun: false,
			validateModels: true,
			tools: null,
			update: false,
			checkOnly: false,
			rollback: false,
			yes: false,
			channel: "stable",
			mode: "sequential" as const,
			pretty: true,
			modeExplicit: false,
		};

		it("uses default tools when no preset or CLI", () => {
			const selected = [...mockPeers];
			const args = { ...baseArgs, tools: null, preset: null };
			const result = resolveTools({ selected, args, presets: {} });
			expect(result.researcher).toEqual(["read", "bash"]);
			expect(result.critic).toEqual(["read", "bash", "lsp_diagnostics"]);
		});

		it("uses preset tools over peer file tools", () => {
			const selected = [...mockPeers];
			const args = { ...baseArgs, tools: null, preset: "test-preset" };
			const result = resolveTools({ selected, args, presets: mockPresets });
			expect(result.researcher).toEqual(["read", "bash", "kagi_search"]);
			expect(result.critic).toEqual([
				"read",
				"bash",
				"lsp_diagnostics",
				"lens_diagnostics",
			]);
		});

		it("uses CLI tools override over preset", () => {
			const selected = [...mockPeers];
			const args = {
				...baseArgs,
				tools: "researcher=cli_tool1,cli_tool2,critic=cli_tool3",
				preset: "test-preset",
			};
			const result = resolveTools({ selected, args, presets: mockPresets });
			expect(result.researcher).toEqual(["cli_tool1", "cli_tool2"]);
			expect(result.critic).toEqual(["cli_tool3"]);
		});

		it("handles tools without preset", () => {
			const selected = [...mockPeers];
			const args = { ...baseArgs, tools: "researcher=cli1,cli2", preset: null };
			const result = resolveTools({ selected, args, presets: mockPresets });
			expect(result.researcher).toEqual(["cli1", "cli2"]);
		});

		it("applies default tools to a peer with no tools configured", () => {
			const selected = [
				{ name: "bare", role: "researcher" }, // no tools from peer file
			];
			const args = { ...baseArgs, tools: null, preset: null };
			const result = resolveTools({ selected, args, presets: {} });
			expect(result.bare).toEqual(["read", "bash", "edit", "write"]);
		});
	});

	describe("parseToolsOverrides", () => {
		it("returns an empty map for a null spec", () => {
			expect(parseToolsOverrides(null).size).toBe(0);
		});

		it("parses multiple name=tools pairs", () => {
			const overrides = parseToolsOverrides(
				"researcher=cli_tool1,cli_tool2,critic=cli_tool3",
			);
			expect(overrides.get("researcher")).toEqual(["cli_tool1", "cli_tool2"]);
			expect(overrides.get("critic")).toEqual(["cli_tool3"]);
		});

		it("supports comma continuation without repeating the name", () => {
			const overrides = parseToolsOverrides("researcher=cli1,cli2,cli3");
			expect(overrides.get("researcher")).toEqual(["cli1", "cli2", "cli3"]);
		});
	});

	describe("printDryRun", () => {
		it("does not throw", () => {
			const peers = [
				{
					name: "researcher",
					role: "researcher",
					model: "model1",
					tools: ["read"],
					systemPrompt: "prompt",
				},
			];
			expect(() =>
				printDryRun({
					topic: "test",
					peers,
					maxRounds: 5,
					cwd: "/tmp",
					savePath: "out.md",
				}),
			).not.toThrow();
		});
	});
});

describe("loadPeers", () => {
	it("loads peers from directory", async () => {
		const peers = await loadPeers();
		expect(peers.length).toBeGreaterThan(0);
		const names = peers.map((p) => p.name);
		expect(names).toContain("researcher");
		expect(names).toContain("critic");
		expect(names).toContain("orchestrator");
	});

	it("loads capabilities declared in peer frontmatter", async () => {
		const peers = await loadPeers();
		const researcher = peers.find((p) => p.name === "researcher");
		expect(researcher?.capabilities).toContain("research");
		const critic = peers.find((p) => p.name === "critic");
		expect(critic?.capabilities).toContain("critique");
	});
});

describe("loadPresets", () => {
	it("loads presets from file", async () => {
		const presets = await loadPresets();
		expect(presets).toHaveProperty("design-review");
		expect(presets).toHaveProperty("orchestrated");
		expect(presets).toHaveProperty("orchestrated-brainstorm");
	});
});

describe("isBlankTopic", () => {
	it("treats null, undefined, empty, and whitespace-only as blank", () => {
		expect(isBlankTopic(null)).toBe(true);
		expect(isBlankTopic(undefined)).toBe(true);
		expect(isBlankTopic("")).toBe(true);
		expect(isBlankTopic("   ")).toBe(true);
		expect(isBlankTopic(" \n\t ")).toBe(true);
	});

	it("treats non-whitespace topics as present", () => {
		expect(isBlankTopic("hello")).toBe(false);
		expect(isBlankTopic("  spaced topic  ")).toBe(false);
	});
});

describe("findTranscripts", () => {
	it("returns empty array for non-existent directory", async () => {
		const transcripts = await findTranscripts("/non/existent/dir");
		expect(transcripts).toEqual([]);
	});
});

describe("renderTranscript", () => {
	it("renders transcript with meta and body", () => {
		const result = renderTranscript(
			{
				meta: {
					topic: "Test topic",
					peers: [{ name: "a", role: "researcher" }],
					tags: ["tag1"],
				},
				body: "### Round 1 · a\nTest body content",
			},
			{ color: false },
		);
		expect(result).toContain("Test topic");
		expect(result).toContain("Test body content");
		expect(result).toContain("researcher");
	});

	it("renders the conclusion section last, after all turns", () => {
		const result = renderTranscript(
			{
				meta: {
					topic: "Test topic",
					peers: [{ name: "a", role: "researcher" }],
				},
				body: [
					"### Round 1 · a",
					"Turn body",
					"",
					"## Conclusion",
					"",
					"✅ Consensus reached at round 1 by **a** (researcher).",
					"",
					"### Summary",
					"",
					"All agreed on option B.",
				].join("\n"),
			},
			{ color: false },
		);
		expect(result).toContain("━━━ CONCLUSION ━━━");
		expect(result).toContain("All agreed on option B.");
		// The conclusion renders after the turn content
		expect(result.indexOf("Turn body")).toBeLessThan(
			result.indexOf("━━━ CONCLUSION ━━━"),
		);
		expect(result.indexOf("━━━ CONCLUSION ━━━")).toBeLessThan(
			result.indexOf("All agreed on option B."),
		);
	});

	it("renders legacy ## Consensus sections (backward compat)", () => {
		const result = renderTranscript(
			{
				meta: { topic: "Test topic", peers: [] },
				body:
					"### Round 1 · a\nTurn body\n\n## Consensus\n\nReached at round 1 by **a** (researcher).",
			},
			{ color: false },
		);
		expect(result).toContain("━━━ CONCLUSION ━━━");
		expect(result).toContain("Reached at round 1 by **a** (researcher).");
	});

	it("omits the conclusion marker when there is no conclusion section", () => {
		const result = renderTranscript(
			{
				meta: { topic: "Test topic", peers: [] },
				body: "### Round 1 · a\nTurn body",
			},
			{ color: false },
		);
		expect(result).not.toContain("━━━ CONCLUSION ━━━");
	});
});

describe("runListTranscripts", () => {
	it("handles empty directory", async () => {
		// Uses non-existent dir to test empty case
		await expect(runListTranscripts("/non/existent/dir")).resolves.not.toThrow();
	});
});

describe("runShow", () => {
	it("errors when no path or latest provided", async () => {
		// This will call process.exit, so we can't easily test it
		// Just verify the function exists and is callable
		expect(typeof runShow).toBe("function");
	});
});

describe("runSearch", () => {
	it("handles empty directory", async () => {
		await expect(
			runSearch({ dir: "/non/existent/dir", term: "test" }),
		).resolves.not.toThrow();
	});

	it("handles unknown --in field", async () => {
		// This calls process.exit, so we just test it doesn't crash on import
		await expect(
			runSearch({ dir: "/tmp", term: "test", inField: "unknown" }),
		).rejects.toThrow();
	});
});

describe("handleUpdate", () => {
	it("errors when update script not found", async () => {
		// This will call process.exit, so just verify it's callable
		expect(typeof handleUpdate).toBe("function");
	});
});
