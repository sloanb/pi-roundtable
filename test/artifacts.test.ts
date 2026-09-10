import { describe, it, expect } from "vitest";
import {
	artifactToMarkdown,
	isStructuredArtifact,
} from "../lib/artifacts.mjs";
import { Roundtable } from "../lib/roundtable.mjs";
import { formatOrchestratorAction } from "../lib/pretty.mjs";
import { renderMarkdown } from "../lib/pi-roundtable.mjs";

const IDEAS = [
	{ name: "--prompt-file", status: "Recommended", complexity: "2/5" },
	{ name: "--prompt-dir", status: "Needs fallback", complexity: "3/5" },
];

function rt(overrides = {}) {
	return new Roundtable({
		peers: [
			{ name: "orchestrator", role: "orchestrator" },
			{ name: "researcher", role: "researcher" },
		],
		topic: "T",
		color: false,
		onUpdate: () => {},
		mode: "orchestrated",
		...overrides,
	});
}

describe("artifactToMarkdown", () => {
	it("passes strings through verbatim (raw JSON escape hatch)", () => {
		const json = '{"schema": "raw", "keep": "me"}';
		expect(artifactToMarkdown("k", json)).toBe(json);
	});

	it("returns null for nullish and empty values", () => {
		expect(artifactToMarkdown("k", null)).toBeNull();
		expect(artifactToMarkdown("k", undefined)).toBeNull();
		expect(artifactToMarkdown("k", "")).toBeNull();
		expect(artifactToMarkdown("k", [])).toBeNull();
		expect(artifactToMarkdown("k", {})).toBeNull();
	});

	it("renders scalars inline", () => {
		expect(artifactToMarkdown("count", 42)).toBe("- **count:** 42");
		expect(artifactToMarkdown("ok", true)).toBe("- **ok:** true");
	});

	it("renders arrays of objects as a Markdown table with union columns", () => {
		const md = artifactToMarkdown("ideas", IDEAS)!;
		expect(md).toContain("#### ideas");
		expect(md).toContain("| name | status | complexity |");
		expect(md).toContain("| --- |");
		expect(md).toContain("| --prompt-file | Recommended | 2/5 |");
		expect(md).toContain("| --prompt-dir | Needs fallback | 3/5 |");
	});

	it("escapes pipes and newlines in table cells", () => {
		const md = artifactToMarkdown("t", [{ a: "x|y", b: "line1\nline2" }])!;
		expect(md).toContain("x\\|y");
		expect(md).toContain("line1<br>line2");
	});

	it("caps table rows with a more-rows note", () => {
		const rows = Array.from({ length: 30 }, (_, i) => ({ i: String(i) }));
		const md = artifactToMarkdown("big", rows)!;
		expect(md).toContain("| 24 |");
		expect(md).not.toContain("| 25 |");
		expect(md).toContain("… +5 more rows");
	});

	it("renders scalar arrays as bullets", () => {
		const md = artifactToMarkdown("paths", ["/a.md", "/b.md"])!;
		expect(md).toContain("#### paths");
		expect(md).toContain("- /a.md");
		expect(md).toContain("- /b.md");
	});

	it("renders objects as bullets with nested values as json blocks", () => {
		const md = artifactToMarkdown("state", {
			plan: "v1",
			details: { steps: ["a", "b"] },
		})!;
		expect(md).toContain("#### state");
		expect(md).toContain("- **plan:** v1");
		expect(md).toContain("```json");
		expect(md).toContain("steps");
	});
});

describe("isStructuredArtifact", () => {
	it("objects and arrays are structured; scalars and null are not", () => {
		expect(isStructuredArtifact({})).toBe(true);
		expect(isStructuredArtifact([])).toBe(true);
		expect(isStructuredArtifact("x")).toBe(false);
		expect(isStructuredArtifact(5)).toBe(false);
		expect(isStructuredArtifact(null)).toBe(false);
	});
});

describe("_recordConclusion: structured artifacts", () => {
	it("converts structured final_artifacts into markdown docs — no [object Object]", () => {
		const r = rt();
		r._recordConclusion({
			byPeer: "orchestrator",
			byRole: "orchestrator",
			round: 1,
			summary: "Done.",
			finalArtifacts: { ideas_for_team_review: IDEAS },
		});
		expect(r.conclusion!.artifacts).toEqual([]);
		expect(r.conclusion!.artifactDocs).toHaveLength(1);
		expect(r.conclusion!.artifactDocs![0].name).toBe("ideas_for_team_review");
		expect(r.conclusion!.artifactDocs![0].markdown).toContain(
			"| name | status | complexity |",
		);
		expect(JSON.stringify(r.conclusion)).not.toContain("[object Object]");
	});

	it("keeps string artifacts flat alongside structured docs", () => {
		const r = rt();
		r._recordConclusion({
			byPeer: "orchestrator",
			byRole: "orchestrator",
			round: 1,
			summary: "Done.",
			finalArtifacts: { "spec.md": "/path/spec.md", ideas: IDEAS },
		});
		expect(r.conclusion!.artifacts).toEqual(["/path/spec.md"]);
		expect(r.conclusion!.artifactDocs).toHaveLength(1);
	});

	it("renders structured workflow-state artifacts as docs", () => {
		const r = rt();
		r.workflowState.artifacts = { idea_1: { name: "x", status: "ok" } };
		r._recordConclusion({
			byPeer: "orchestrator",
			byRole: "orchestrator",
			round: 1,
			summary: "Done.",
		});
		expect(r.conclusion!.artifactDocs).toHaveLength(1);
		expect(r.conclusion!.artifactDocs![0].markdown).toContain(
			"- **name:** x",
		);
	});
});

describe("conclusion rendering with artifact docs", () => {
	const doc = {
		name: "ideas",
		markdown: "#### ideas\n\n| name |\n| --- |\n| --prompt-file |",
	};

	it("renders docs in the console conclusion block", () => {
		const r = rt();
		r.conclusion = {
			mode: "orchestrated",
			byPeer: "orchestrator",
			byRole: "orchestrator",
			round: 1,
			summary: "The orchestrator's final word.",
			structured: null,
			artifacts: [],
			artifactDocs: [doc],
			completedTasks: [],
			pendingTasks: [],
			blockedTasks: [],
			peerFindings: null,
		};
		const block = r._buildConclusionBlock(true);
		expect(block).toContain("Artifact: ideas");
		expect(block).toContain("| --prompt-file |");
		expect(block).not.toContain("[object Object]");
		// Order: docs render before the summary (orchestrator's last word)
		expect(block.indexOf("Artifact: ideas")).toBeLessThan(
			block.indexOf("Summary:"),
		);
	});

	it("non-pretty decision display shows the done summary", () => {
		const r = rt({ pretty: false });
		const logs: string[] = [];
		r.onUpdate = (s: string) => logs.push(s);
		r._displayOrchestratorDecision({ action: "done", summary: "All done." });
		const out = logs.join("");
		expect(out).toContain("Consensus Reached");
		expect(out).toContain("All done.");
	});

	it("pretty decision display hints docs are rendered in the conclusion", () => {
		const text = formatOrchestratorAction(
			{ action: "done", summary: "s", final_artifacts: { ideas: [] } },
			false,
		);
		expect(text).toContain("Artifacts: ideas (rendered in the conclusion)");
	});

	it("saved transcripts render docs in the Conclusion Details", () => {
		const md = renderMarkdown({
			topic: "T",
			peers: [{ name: "orchestrator", role: "orchestrator" }],
			rounds: 1,
			consensus: true,
			transcript: [
				{ peer: "orchestrator", role: "orchestrator", text: "x", round: 1 },
			],
			startedAt: 0,
			endedAt: 1,
			conclusion: {
				mode: "orchestrated",
				byPeer: "orchestrator",
				byRole: "orchestrator",
				round: 1,
				summary: "The orchestrator's final word.",
				structured: null,
				artifacts: [],
				artifactDocs: [doc],
				completedTasks: [],
				pendingTasks: [],
				blockedTasks: [],
				peerFindings: [],
			},
		});
		expect(md).toContain("#### Artifact: ideas");
		expect(md).toContain("| --prompt-file |");
		// Summary is still the final section of the file
		expect(md.indexOf("#### Artifact: ideas")).toBeLessThan(
			md.indexOf("### Summary"),
		);
	});
});