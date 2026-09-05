import { describe, it, expect } from "vitest";
import {
	parseAgentJSON,
	validateOrchestratorAction,
	validatePeerReport,
	Roundtable,
} from "../lib/roundtable.mjs";

const validRouteAction = {
	action: "route",
	next_peer: "implementer",
	instruction: "review lib files",
	reason: "only peer",
	expected_output: "test plan",
	state_update: {
		completed_tasks: [],
		pending_tasks: ["task"],
		blocked_tasks: [],
		artifacts: {},
	},
};

describe("orchestrator JSON schema", () => {
	describe("validateOrchestratorAction", () => {
		it("accepts a valid route action", () => {
			expect(validateOrchestratorAction(validRouteAction)).toBe(true);
		});

		it("rejects unknown action kinds", () => {
			expect(validateOrchestratorAction({ action: "route2" })).toBe(false);
		});

		it("rejects route actions missing required string fields", () => {
			const { reason, ...missing } = validRouteAction;
			expect(validateOrchestratorAction(missing)).toBe(false);
		});

		it("accepts a done action with a summary", () => {
			expect(validateOrchestratorAction({ action: "done", summary: "ok" })).toBe(
				true,
			);
		});
	});

	describe("validatePeerReport", () => {
		const validReport = {
			status: "complete",
			findings: "did it",
			artifacts: ["a.md"],
			recommended_next_peer: null,
		};

		it("accepts a valid report", () => {
			expect(validatePeerReport(validReport)).toBe(true);
		});

		it("rejects unknown status values", () => {
			expect(validatePeerReport({ ...validReport, status: "done" })).toBe(false);
		});

		it("rejects non-array artifacts", () => {
			expect(validatePeerReport({ ...validReport, artifacts: "a.md" })).toBe(
				false,
			);
		});
	});

	describe("parseAgentJSON", () => {
		it("parses fenced JSON containing nested objects (state_update)", () => {
			const fenced = `\`\`\`json\n${JSON.stringify(validRouteAction, null, 2)}\n\`\`\``;
			expect(parseAgentJSON(fenced)).toEqual(validRouteAction);
		});

		it("extracts bare JSON embedded in prose", () => {
			const prose = `Decision:\n\n${JSON.stringify(validRouteAction)}\n\nEnd with [YIELD].`;
			expect(parseAgentJSON(prose)).toEqual(validRouteAction);
		});

		it("returns null on non-JSON text", () => {
			expect(parseAgentJSON("no json here at all")).toBeNull();
		});
	});
});

describe("workflow state updates", () => {
	it("_applyStateUpdate replaces task lists", () => {
		const rt = new Roundtable({
			peers: [{ name: "a", role: "a" }],
			topic: "t",
			onUpdate: () => {},
		});
		rt._applyStateUpdate({ completed_tasks: ["c1"], pending_tasks: ["p1"] });
		expect(rt.workflowState.completed_tasks).toEqual(["c1"]);
		expect(rt.workflowState.pending_tasks).toEqual(["p1"]);
	});

	it("_applyStateUpdate merges artifacts across updates without clobbering", () => {
		const rt = new Roundtable({
			peers: [{ name: "a", role: "a" }],
			topic: "t",
			onUpdate: () => {},
		});
		rt._applyStateUpdate({ artifacts: { plan: "plan.md" } });
		rt._applyStateUpdate({ artifacts: { report: "report.md" } });
		expect(Object.keys(rt.workflowState.artifacts).sort()).toEqual([
			"plan",
			"report",
		]);
	});
});
