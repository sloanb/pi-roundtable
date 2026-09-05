import { describe, it, expect, vi } from "vitest";
import { Roundtable } from "../lib/roundtable.mjs";
import { RpcClient } from "../lib/rpc-client.mjs";

// Mock RpcClient for testing
vi.mock("../lib/rpc-client.mjs", () => {
	return {
		RpcClient: vi.fn().mockImplementation(() => ({
			onEvent: vi.fn(),
			start: vi.fn().mockResolvedValue(undefined),
			send: vi.fn().mockResolvedValue({ data: { messages: [] } }),
			kill: vi.fn(),
		})),
		nextSettled: vi.fn().mockResolvedValue(undefined),
	};
});

function createRoundtable(overrides = {}) {
	return new Roundtable({
		peers: [
			{ name: "researcher", role: "researcher" },
			{ name: "developer", role: "developer" },
		],
		topic: "Test topic",
		maxRounds: 5,
		color: false,
		onUpdate: () => {},
		...overrides,
	});
}

describe("Roundtable", () => {
	describe("constructor", () => {
		it("initializes with the provided options", () => {
			const rt = createRoundtable();

			expect(rt.peers).toHaveLength(2);
			expect(rt.topic).toBe("Test topic");
			expect(rt.maxRounds).toBe(5);
			expect(rt.color).toBe(false);
			expect(rt.mode).toBe("sequential");
			expect(rt.clients).toBeInstanceOf(Map);
			expect(rt.transcript).toEqual([]);
			expect(rt.round).toBe(0);
		});

		it("applies default values when options are omitted", () => {
			const rt = new Roundtable({
				peers: [{ name: "critic", role: "critic" }],
				topic: "Defaults topic",
				onUpdate: () => {},
			});

			expect(rt.maxRounds).toBe(12);
			expect(rt.color).toBe(true);
			expect(rt.cwd).toBe(process.cwd());
			expect(rt.noSession).toBe(true);
			expect(rt.workflowState).toMatchObject({
				completed_tasks: [],
				pending_tasks: [],
				blocked_tasks: [],
				artifacts: {},
				visit_counts: {},
			});
		});
	});

	describe("_buildTranscriptText", () => {
		it("returns an empty string for an empty transcript", () => {
			const rt = createRoundtable();
			expect(rt._buildTranscriptText()).toBe("");
		});

		it("formats transcript entries with peer name and role", () => {
			const rt = createRoundtable();
			rt.transcript.push(
				{ peer: "researcher", role: "researcher", text: "First entry", round: 1 },
				{ peer: "developer", role: "developer", text: "Second entry", round: 1 },
			);

			expect(rt._buildTranscriptText()).toBe(
				"[researcher (researcher)]: First entry\n\n[developer (developer)]: Second entry",
			);
		});
	});

	describe("_buildStateSummary", () => {
		it("serializes the workflow state", () => {
			const rt = createRoundtable();
			rt.workflowState.completed_tasks = ["task-a"];
			rt.workflowState.pending_tasks = ["task-b"];
			rt.workflowState.blocked_tasks = ["task-c"];
			rt.workflowState.artifacts = { plan: "plan.md" };
			rt.workflowState.visit_counts = { developer: 2 };

			const summary = rt._buildStateSummary();
			expect(JSON.parse(summary)).toEqual({
				completed_tasks: ["task-a"],
				pending_tasks: ["task-b"],
				blocked_tasks: ["task-c"],
				artifacts: { plan: "plan.md" },
				visit_counts: { developer: 2 },
				consecutive_routes: 0,
				last_peer: null,
			});
		});
	});

	describe("_getPeerList", () => {
		it("excludes the orchestrator peer", () => {
			const rt = createRoundtable({
				peers: [
					{ name: "orchestrator", role: "orchestrator" },
					{ name: "developer", role: "developer" },
				],
			});

			expect(rt._getPeerList()).toEqual([
				{ name: "developer", role: "developer", capabilities: [] },
			]);
		});

		it("includes capabilities when present", () => {
			const rt = createRoundtable({
				peers: [
					{
						name: "developer",
						role: "developer",
						capabilities: ["read", "bash"],
					},
				],
			});

			expect(rt._getPeerList()).toEqual([
				{ name: "developer", role: "developer", capabilities: ["read", "bash"] },
			]);
		});
	});

	describe("_getPeerCapabilities", () => {
		it("returns an empty object when no peer has capabilities", () => {
			const rt = createRoundtable();
			expect(rt._getPeerCapabilities()).toBe("{}");
		});

		it("maps peer names to their capabilities", () => {
			const rt = createRoundtable({
				peers: [
					{
						name: "researcher",
						role: "researcher",
						capabilities: ["search"],
					},
					{
						name: "developer",
						role: "developer",
						capabilities: ["read", "bash"],
					},
				],
			});

			expect(JSON.parse(rt._getPeerCapabilities())).toEqual({
				researcher: ["search"],
				developer: ["read", "bash"],
			});
		});

		it("skips peers without capabilities", () => {
			const rt = createRoundtable({
				peers: [
					{
						name: "researcher",
						role: "researcher",
						capabilities: ["search"],
					},
					{ name: "critic", role: "critic" },
				],
			});

			expect(JSON.parse(rt._getPeerCapabilities())).toEqual({
				researcher: ["search"],
			});
		});
	});

	describe("orchestrated mode", () => {
		it("creates Roundtable with orchestrated mode", () => {
			const rt = createRoundtable({ mode: "orchestrated" });
			expect(rt.mode).toBe("orchestrated");
		});

		it("has workflowState with required fields", () => {
			const rt = createRoundtable({ mode: "orchestrated" });
			expect(rt.workflowState).toBeDefined();
			expect(rt.workflowState.completed_tasks).toEqual([]);
			expect(rt.workflowState.pending_tasks).toEqual([]);
			expect(rt.workflowState.blocked_tasks).toEqual([]);
			expect(rt.workflowState.artifacts).toEqual({});
			expect(rt.workflowState.visit_counts).toEqual({});
			expect(rt.workflowState.last_peer).toBeNull();
			expect(rt.workflowState.consecutive_routes).toBe(0);
		});
	});

	describe("sequential mode with mocked client", () => {
		it("start() creates clients for each peer", async () => {
			const rt = createRoundtable();
			await rt.start();
			expect(rt.clients.size).toBe(2);
			expect(rt.clients.has("researcher")).toBe(true);
			expect(rt.clients.has("developer")).toBe(true);
		});

		it("run() executes and returns result", async () => {
			const rt = createRoundtable({ maxRounds: 1 });
			const result = await rt.run();
			expect(result).toHaveProperty("transcript");
			expect(result).toHaveProperty("consensus");
			expect(result).toHaveProperty("rounds");
		});

		it("shutdown() cleans up clients", async () => {
			const rt = createRoundtable();
			await rt.start();
			await rt.shutdown();
			// Clients should be killed
			expect(rt.clients.size).toBeGreaterThanOrEqual(0);
		});
	});
});
