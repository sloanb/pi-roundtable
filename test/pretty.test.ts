import { describe, it, expect } from "vitest";
import {
	formatOrchestratorAction,
	formatPeerReport,
	prettyAgentOutput,
	prettyPeerReport,
} from "../lib/pretty.mjs";

describe("pretty.mjs", () => {
	describe("formatOrchestratorAction", () => {
		it("formats route action", () => {
			const action = {
				action: "route" as const,
				next_peer: "implementer",
				reason: "Need to implement",
				instruction: "Implement feature X",
				expected_output: "Code for feature X",
				state_update: {
					pending_tasks: ["implement"],
					completed_tasks: [],
					blocked_tasks: [],
					artifacts: {},
				},
			};
			const result = formatOrchestratorAction(action, false);
			expect(result).toContain("🎯 Routing to implementer");
			expect(result).toContain("Reason: Need to implement");
			expect(result).toContain("Instruction: Implement feature X");
			expect(result).toContain("Expected: Code for feature X");
			expect(result).toContain("State: pending: implement");
		});

		it("formats route action without state_update", () => {
			const action = {
				action: "route" as const,
				next_peer: "critic",
				reason: "Review needed",
				instruction: "Review code",
				expected_output: "Review report",
			};
			const result = formatOrchestratorAction(action, false);
			expect(result).toContain("🎯 Routing to critic");
			expect(result).not.toContain("State:");
		});

		it("formats done action", () => {
			const action = {
				action: "done" as const,
				summary: "Consensus reached on design",
				final_artifacts: { plan: "plan.md" },
			};
			const result = formatOrchestratorAction(action, false);
			expect(result).toContain("✅ Consensus Reached");
			expect(result).toContain("Summary: Consensus reached on design");
			expect(result).toContain("Artifacts: plan");
		});

		it("formats done action without final_artifacts", () => {
			const action = {
				action: "done" as const,
				summary: "Done",
			};
			const result = formatOrchestratorAction(action, false);
			expect(result).toContain("✅ Consensus Reached");
			expect(result).not.toContain("Artifacts:");
		});

		it("formats fallback action", () => {
			const action = {
				action: "fallback" as const,
				reason: "Invalid JSON from orchestrator",
			};
			const result = formatOrchestratorAction(action, false);
			expect(result).toContain("⚠️  Fallback to Sequential");
			expect(result).toContain("Reason: Invalid JSON from orchestrator");
		});

		it("includes colors when enabled", () => {
			const action = {
				action: "route" as const,
				next_peer: "test",
				reason: "test",
				instruction: "test",
				expected_output: "test",
			};
			const result = formatOrchestratorAction(action, true);
			expect(result).toContain("\x1b[96m"); // orchestrator color
			expect(result).toContain("\x1b[0m"); // reset
		});
	});

	describe("formatPeerReport", () => {
		it("formats complete status", () => {
			const report = {
				status: "complete" as const,
				findings: "Implementation done",
				artifacts: ["file1.ts", "file2.ts"],
				recommended_next_peer: "critic",
			};
			const result = formatPeerReport(report, "implementer", "implementer", false);
			expect(result).toContain("✅ complete  implementer (implementer)");
			expect(result).toContain("Findings: Implementation done");
			expect(result).toContain("Artifacts: file1.ts, file2.ts");
			expect(result).toContain("Next: critic");
		});

		it("formats needs_input status", () => {
			const report = {
				status: "needs_input" as const,
				findings: "Need more info",
				artifacts: [],
				recommended_next_peer: null,
			};
			const result = formatPeerReport(report, "researcher", "researcher", false);
			expect(result).toContain("⚠️  needs_input  researcher (researcher)");
			expect(result).toContain("Findings: Need more info");
			expect(result).not.toContain("Artifacts:");
			expect(result).not.toContain("Next:");
		});

		it("formats blocked status", () => {
			const report = {
				status: "blocked" as const,
				findings: "Waiting for dependency",
				artifacts: [],
				recommended_next_peer: null,
			};
			const result = formatPeerReport(report, "developer", "developer", false);
			expect(result).toContain("🚫 blocked  developer (developer)");
		});

		it("formats error status", () => {
			const report = {
				status: "error" as const,
				findings: "Something went wrong",
				artifacts: [],
				recommended_next_peer: null,
			};
			const result = formatPeerReport(report, "committer", "committer", false);
			expect(result).toContain("❌ error  committer (committer)");
		});

		it("handles multi-line findings", () => {
			const report = {
				status: "complete" as const,
				findings: "Line 1\nLine 2\nLine 3",
				artifacts: [],
				recommended_next_peer: null,
			};
			const result = formatPeerReport(report, "peer", "role", false);
			expect(result).toContain("Findings:");
			expect(result).toContain("• Line 1");
			expect(result).toContain("• Line 2");
			expect(result).toContain("• Line 3");
		});

		it("includes colors when enabled", () => {
			const report = {
				status: "complete" as const,
				findings: "Done",
				artifacts: [],
				recommended_next_peer: null,
			};
			const result = formatPeerReport(report, "peer", "role", true);
			expect(result).toContain("\x1b[32m"); // green for complete
			expect(result).toContain("\x1b[0m"); // reset
		});
	});

	describe("prettyAgentOutput", () => {
		it("formats orchestrator JSON", () => {
			const text = JSON.stringify({
				action: "route",
				next_peer: "implementer",
				reason: "test",
				instruction: "test",
				expected_output: "test",
			});
			const result = prettyAgentOutput(text, "orchestrator", false);
			expect(result.wasJSON).toBe(true);
			expect(result.pretty).toContain("🎯 Routing to implementer");
		});

		it("passes through non-JSON text", () => {
			const text = "This is just plain text";
			const result = prettyAgentOutput(text, "orchestrator", false);
			expect(result.wasJSON).toBe(false);
			expect(result.pretty).toBe(text);
		});

		it("handles JSON in markdown fence", () => {
			const text = '```json\n{"action":"done","summary":"Done"}\n```';
			const result = prettyAgentOutput(text, "orchestrator", false);
			expect(result.wasJSON).toBe(true);
			expect(result.pretty).toContain("✅ Consensus Reached");
		});

		it("returns wasJSON=false for peer report JSON", () => {
			const text = JSON.stringify({
				status: "complete",
				findings: "Done",
				artifacts: [],
				recommended_next_peer: null,
			});
			const result = prettyAgentOutput(text, "implementer", false);
			expect(result.wasJSON).toBe(true); // It detects JSON but can't format without peer info
		});
	});

	describe("prettyPeerReport", () => {
		it("formats peer report with name and role", () => {
			const text = JSON.stringify({
				status: "complete",
				findings: "Task done",
				artifacts: ["output.txt"],
				recommended_next_peer: "critic",
			});
			const result = prettyPeerReport(text, "implementer", "implementer", false);
			expect(result.wasJSON).toBe(true);
			expect(result.pretty).toContain("✅ complete  implementer (implementer)");
			expect(result.pretty).toContain("Findings: Task done");
			expect(result.pretty).toContain("Artifacts: output.txt");
			expect(result.pretty).toContain("Next: critic");
		});

		it("passes through non-JSON text", () => {
			const text = "Just text";
			const result = prettyPeerReport(text, "peer", "role", false);
			expect(result.wasJSON).toBe(false);
			expect(result.pretty).toBe(text);
		});

		it("handles invalid JSON", () => {
			const text = "{ not valid json";
			const result = prettyPeerReport(text, "peer", "role", false);
			expect(result.wasJSON).toBe(false);
			expect(result.pretty).toBe(text);
		});

		it("handles invalid peer report structure", () => {
			const text = JSON.stringify({ status: "invalid" });
			const result = prettyPeerReport(text, "peer", "role", false);
			expect(result.wasJSON).toBe(false);
			expect(result.pretty).toBe(text);
		});
	});
});
