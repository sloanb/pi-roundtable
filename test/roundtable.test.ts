import { describe, it, expect, vi } from "vitest";
import { Roundtable } from "../lib/roundtable.mjs";

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

	describe("conclusion", () => {
		function fakeClient(text: string) {
			return {
				onEvent: vi.fn(),
				kill: vi.fn(),
				send: vi.fn().mockResolvedValue({
					data: {
						messages: [
							{
								role: "assistant",
								content: [{ type: "text", text }],
							},
						],
					},
				}),
			};
		}

		it("starts with a null conclusion", () => {
			const rt = createRoundtable();
			expect(rt.conclusion).toBeNull();
		});

		it("_recordConclusion captures sequential conclusion data", () => {
			const rt = createRoundtable();
			rt._recordConclusion({
				byPeer: "researcher",
				byRole: "researcher",
				round: 3,
				summary: "We agree on option B.",
			});
			expect(rt.conclusion).toMatchObject({
				mode: "sequential",
				byPeer: "researcher",
				byRole: "researcher",
				round: 3,
				summary: "We agree on option B.",
				artifacts: [],
				completedTasks: null,
				pendingTasks: null,
				blockedTasks: null,
				peerFindings: null,
			});
		});

		it("_recordConclusion captures orchestrated details and dedupes artifacts", () => {
			const rt = createRoundtable({ mode: "orchestrated" });
			rt.workflowState.completed_tasks = ["research"];
			rt.workflowState.pending_tasks = ["review"];
			rt.workflowState.artifacts = { spec: "spec.md" };
			rt.transcript.push({
				peer: "researcher",
				role: "researcher",
				round: 1,
				text: "raw json",
				structured: {
					status: "complete",
					findings: "Found prior art.",
					artifacts: ["notes.md", "spec.md"],
					recommended_next_peer: null,
				},
			});
			rt._recordConclusion({
				byPeer: "orchestrator",
				byRole: "orchestrator",
				round: 2,
				summary: "All tasks complete.",
				finalArtifacts: { report: "report.md" },
			});
			expect(rt.conclusion!.mode).toBe("orchestrated");
			expect(rt.conclusion!.completedTasks).toEqual(["research"]);
			expect(rt.conclusion!.pendingTasks).toEqual(["review"]);
			expect(rt.conclusion!.artifacts).toEqual([
				"report.md",
				"spec.md",
				"notes.md",
			]);
			expect(rt.conclusion!.peerFindings).toEqual([
				{
					peer: "researcher",
					role: "researcher",
					status: "complete",
					findings: "Found prior art.",
					artifacts: ["notes.md", "spec.md"],
				},
			]);
		});

		it("_recordConclusion defaults the summary when it is empty", () => {
			const rt = createRoundtable();
			rt._recordConclusion({
				byPeer: "critic",
				byRole: "critic",
				round: 1,
				summary: "   ",
			});
			expect(rt.conclusion!.summary).toBe("(no summary provided)");
		});

		it("_collectPeerFindings keeps the last report per peer and skips non-reports", () => {
			const rt = createRoundtable({ mode: "orchestrated" });
			rt.transcript.push(
				{
					peer: "researcher",
					role: "researcher",
					round: 1,
					text: "t",
					structured: {
						status: "complete",
						findings: "first",
						artifacts: [],
						recommended_next_peer: null,
					},
				},
				{
					peer: "orchestrator",
					role: "orchestrator",
					round: 1,
					text: "t",
					structured: {
						action: "route",
						next_peer: "researcher",
						instruction: "i",
						reason: "r",
						expected_output: "e",
					},
				},
				{
					peer: "researcher",
					role: "researcher",
					round: 2,
					text: "t",
					structured: {
						status: "complete",
						findings: "second",
						artifacts: ["a.md"],
						recommended_next_peer: null,
					},
				},
				{ peer: "critic", role: "critic", round: 2, text: "no report" },
			);
			const findings = rt._collectPeerFindings();
			expect(findings).toHaveLength(1);
			expect(findings[0].findings).toBe("second");
			expect(findings[0].artifacts).toEqual(["a.md"]);
		});

		describe("_buildConclusionBlock", () => {
			it("renders the summary and all details on consensus", () => {
				const rt = createRoundtable({ mode: "orchestrated" });
				rt.conclusion = {
					mode: "orchestrated",
					byPeer: "orchestrator",
					byRole: "orchestrator",
					round: 2,
					summary: "All tasks complete.",
					structured: null,
					artifacts: ["src/auth.ts"],
					completedTasks: ["research", "implement"],
					pendingTasks: [],
					blockedTasks: [],
					peerFindings: [
						{
							peer: "researcher",
							role: "researcher",
							status: "complete",
							findings: "Found prior art.",
							artifacts: [],
						},
					],
				};
				const block = rt._buildConclusionBlock(true);
				expect(block).toContain("📋 CONCLUSION");
				expect(block).toContain("✅ consensus reached");
				expect(block).toContain("Topic:        Test topic");
				expect(block).toContain(
					"Concluded by: 🎯 orchestrator (orchestrator) at round 2 of 5 (orchestrated mode)",
				);
				expect(block).toContain("Summary:");
				expect(block).toContain("All tasks complete.");
				expect(block).toContain("Artifacts produced: src/auth.ts");
				expect(block).toContain("Tasks completed: research, implement");
				expect(block).toContain("researcher (researcher) — ✅ complete");
				expect(block).toContain("Found prior art.");
			});

			it("omits empty detail bullets", () => {
				const rt = createRoundtable();
				rt.conclusion = {
					mode: "sequential",
					byPeer: "researcher",
					byRole: "researcher",
					round: 1,
					summary: "We agree.",
					structured: null,
					artifacts: [],
					completedTasks: [],
					pendingTasks: [],
					blockedTasks: [],
					peerFindings: null,
				};
				const block = rt._buildConclusionBlock(true);
				expect(block).toContain("We agree.");
				expect(block).not.toContain("Artifacts produced:");
				expect(block).not.toContain("Tasks completed:");
				expect(block).not.toContain("Peer contributions");
			});

			it("omits peer findings in compact mode", () => {
				const rt = createRoundtable({ mode: "orchestrated", compact: true });
				rt.conclusion = {
					mode: "orchestrated",
					byPeer: "orchestrator",
					byRole: "orchestrator",
					round: 1,
					summary: "Done.",
					structured: null,
					artifacts: [],
					completedTasks: null,
					pendingTasks: null,
					blockedTasks: null,
					peerFindings: [
						{
							peer: "researcher",
							role: "researcher",
							status: "complete",
							findings: "Found prior art.",
							artifacts: [],
						},
					],
				};
				const block = rt._buildConclusionBlock(true);
				expect(block).toContain("Done.");
				expect(block).not.toContain("Peer contributions");
				expect(block).not.toContain("Found prior art.");
			});

			it("falls back to the last turn when no conclusion was recorded", () => {
				const rt = createRoundtable();
				rt.transcript.push({
					peer: "critic",
					role: "critic",
					text: "Final word on the matter.",
					round: 2,
				});
				const block = rt._buildConclusionBlock(true);
				expect(block).toContain("📋 CONCLUSION");
				expect(block).toContain("Final word on the matter.");
				expect(block).toContain("Concluded by: 🔎 critic");
			});

			it("renders a clear no-conclusion outcome without consensus", () => {
				const rt = createRoundtable({ maxRounds: 2 });
				rt.round = 2;
				rt.transcript.push({
					peer: "critic",
					role: "critic",
					text: "still going",
					round: 2,
				});
				const block = rt._buildConclusionBlock(false);
				expect(block).toContain("no conclusion");
				expect(block).toContain("round limit (2) reached");
				expect(block).toContain("Last speaker: 🔎 critic");
				expect(block).toContain("--max-rounds");
				expect(block).not.toContain("📋 CONCLUSION —");
			});

			it("reports ended-early when the round limit was not reached", () => {
				const rt = createRoundtable({ maxRounds: 12 });
				rt.round = 2;
				const block = rt._buildConclusionBlock(false);
				expect(block).toContain("ended early");
				expect(block).toContain("No turns completed.");
			});
		});

		describe("_finishRun", () => {
			it("prints the conclusion before the END footer and returns the result", () => {
				const rt = createRoundtable();
				rt.transcript.push({
					peer: "researcher",
					role: "researcher",
					text: "We agree.",
					round: 1,
				});
				rt._recordConclusion({
					byPeer: "researcher",
					byRole: "researcher",
					round: 1,
					summary: "We agree.",
				});
				const logs: string[] = [];
				rt.onUpdate = (s) => logs.push(s);
				const result = rt._finishRun(true);
				expect(result.consensus).toBe(true);
				expect(result.rounds).toBe(rt.round);
				expect(result.conclusion).toBe(rt.conclusion);
				expect(result.transcript).toBe(rt.transcript);
				const all = logs.join("");
				expect(all).toContain("📋 CONCLUSION");
				expect(all).toContain("━━━ END ━━━");
				expect(all.indexOf("📋 CONCLUSION")).toBeLessThan(
					all.indexOf("━━━ END ━━━"),
				);
			});
		});

		describe("run() integration", () => {
			it("records the conclusion and prints it before the footer when a peer emits [DONE] (sequential)", async () => {
				const fake = fakeClient("We all agree. [DONE]");
				const rt = createRoundtable({ maxRounds: 3 });
				rt.start = async () => {
					rt.clients.set("researcher", fake);
					rt.clients.set("developer", fake);
				};
				const logs: string[] = [];
				rt.onUpdate = (s) => logs.push(s);
				const result = await rt.run();
				expect(result.consensus).toBe(true);
				expect(result.conclusion).toMatchObject({
					mode: "sequential",
					byPeer: "researcher",
					byRole: "researcher",
					round: 1,
					summary: "We all agree.",
				});
				const all = logs.join("");
				expect(all).toContain("📋 CONCLUSION");
				expect(all).toContain("We all agree.");
				expect(all.indexOf("📋 CONCLUSION")).toBeLessThan(
					all.indexOf("━━━ END ━━━"),
				);
			});

			it("records the conclusion when the orchestrator signals done (orchestrated)", async () => {
				const doneAction = {
					action: "done",
					summary: "All tasks complete.",
					final_artifacts: { report: "report.md" },
				};
				const fake = fakeClient(JSON.stringify(doneAction));
				const rt = createRoundtable({
					peers: [
						{ name: "orchestrator", role: "orchestrator" },
						{ name: "researcher", role: "researcher" },
					],
					mode: "orchestrated",
					maxRounds: 3,
				});
				rt.start = async () => {
					rt.clients.set("orchestrator", fake);
				};
				const logs: string[] = [];
				rt.onUpdate = (s) => logs.push(s);
				const result = await rt.run();
				expect(result.consensus).toBe(true);
				expect(result.conclusion).toMatchObject({
					mode: "orchestrated",
					byPeer: "orchestrator",
					byRole: "orchestrator",
					summary: "All tasks complete.",
				});
				expect(result.conclusion!.artifacts).toEqual(["report.md"]);
				const all = logs.join("");
				expect(all).toContain("📋 CONCLUSION");
				expect(all).toContain("All tasks complete.");
				expect(all.indexOf("📋 CONCLUSION")).toBeLessThan(
					all.indexOf("━━━ END ━━━"),
				);
			});

			it("returns a null conclusion when max rounds are reached without [DONE]", async () => {
				const fake = fakeClient("Still discussing. [YIELD]");
				const rt = createRoundtable({ maxRounds: 1 });
				rt.start = async () => {
					rt.clients.set("researcher", fake);
					rt.clients.set("developer", fake);
				};
				rt.onUpdate = () => {};
				const result = await rt.run();
				expect(result.consensus).toBe(false);
				expect(result.conclusion).toBeNull();
			});
		});

		describe("_fallbackTurn", () => {
			it("returns true and records the conclusion when the fallback worker emits [DONE]", async () => {
				const fake = fakeClient("Done here. [DONE]");
				const rt = createRoundtable({
					peers: [
						{ name: "orchestrator", role: "orchestrator" },
						{ name: "researcher", role: "researcher" },
					],
					mode: "orchestrated",
				});
				rt.round = 1;
				rt.clients.set("researcher", fake);
				const done = await rt._fallbackTurn();
				expect(done).toBe(true);
				expect(rt.conclusion).toMatchObject({
					byPeer: "researcher",
					summary: "Done here.",
				});
				expect(rt.transcript).toHaveLength(1);
			});

			it("returns false when the fallback worker yields", async () => {
				const fake = fakeClient("More to do. [YIELD]");
				const rt = createRoundtable({
					peers: [
						{ name: "orchestrator", role: "orchestrator" },
						{ name: "researcher", role: "researcher" },
					],
					mode: "orchestrated",
				});
				rt.round = 1;
				rt.clients.set("researcher", fake);
				const done = await rt._fallbackTurn();
				expect(done).toBe(false);
				expect(rt.conclusion).toBeNull();
			});

			it("returns false when there are no worker peers", async () => {
				const rt = createRoundtable({
					peers: [{ name: "orchestrator", role: "orchestrator" }],
					mode: "orchestrated",
				});
				rt.round = 1;
				const done = await rt._fallbackTurn();
				expect(done).toBe(false);
			});
		});
	});

	describe("thinking animation lifecycle", () => {
		/** A peer object carrying the runtime thinking-animation state fields. */
		type ThinkingPeer = {
			name: string;
			role: string;
			_streamedTurn?: boolean;
			_firstTokenReceived?: boolean;
			_thinkingInterval?: ReturnType<typeof setInterval> | null;
			_thinkingTimeout?: ReturnType<typeof setTimeout> | null;
			_thinkingDrawn?: boolean;
		};

		function fakeClient(text: string) {
			return {
				onEvent: vi.fn(),
				kill: vi.fn(),
				send: vi.fn().mockResolvedValue({
					data: {
						messages: [{ role: "assistant", content: [{ type: "text", text }] }],
					},
				}),
			};
		}

		/** Stub the TTY flag so the thinking animation runs under tests, restoring on exit. */
		function stubTTY() {
			const orig = process.stdout.isTTY;
			Object.defineProperty(process.stdout, "isTTY", {
				value: true,
				configurable: true,
			});
			return () => {
				Object.defineProperty(process.stdout, "isTTY", {
					value: orig,
					configurable: true,
				});
			};
		}

		it("stops the spinner on the first text delta even in pretty mode", () => {
			vi.useFakeTimers();
			const restore = stubTTY();
			try {
				const logs: string[] = [];
				const rt = createRoundtable({
					pretty: true,
					onUpdate: (s: string) => logs.push(s),
				});
				const peer: ThinkingPeer = {
					name: "researcher",
					role: "researcher",
					_streamedTurn: false,
				};
				const listeners: Array<(evt: unknown) => void> = [];
				const client = {
					onEvent: (fn: (evt: unknown) => void) => {
						listeners.push(fn);
						return () => {};
					},
					kill: vi.fn(),
				};
				rt._wireLog(client, peer);
				rt._startThinking(peer);
				expect(peer._thinkingTimeout).toBeTruthy();
				vi.advanceTimersByTime(600);
				expect(peer._thinkingInterval).toBeTruthy();

				for (const l of listeners) {
					l({
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "H" },
					});
				}
				expect(peer._firstTokenReceived).toBe(true);
				expect(peer._thinkingInterval).toBeNull();
				expect(peer._thinkingTimeout).toBeNull();
				// pretty mode: deltas are not streamed to the console
				expect(peer._streamedTurn).toBe(false);
				// the drawn spinner line is erased
				expect(logs).toContain("\r\x1b[K");
				// no more frames after the stop
				const frames = logs.filter((l) => l.includes("is thinking")).length;
				vi.advanceTimersByTime(1000);
				expect(logs.filter((l) => l.includes("is thinking")).length).toBe(frames);
			} finally {
				restore();
				vi.useRealTimers();
			}
		});

		it("restarting the animation clears the previous timers (no zombie intervals)", () => {
			vi.useFakeTimers();
			const restore = stubTTY();
			try {
				const rt = createRoundtable({ onUpdate: () => {} });
				const peer: ThinkingPeer = { name: "researcher", role: "researcher" };
				rt._startThinking(peer);
				const first = peer._thinkingTimeout;
				expect(first).toBeTruthy();
				rt._startThinking(peer);
				expect(peer._thinkingTimeout).not.toBe(first);
				rt._stopThinking(peer);
				expect(peer._thinkingTimeout).toBeNull();
				expect(peer._thinkingInterval).toBeNull();
				// If the first timeout had leaked, it would fire now and start an
				// interval; no pending timers means no leak.
				vi.advanceTimersByTime(2000);
				expect(vi.getTimerCount()).toBe(0);
			} finally {
				restore();
				vi.useRealTimers();
			}
		});

		it("_stopThinking erases the spinner line only when a frame was drawn", () => {
			vi.useFakeTimers();
			const restore = stubTTY();
			try {
				const logs: string[] = [];
				const rt = createRoundtable({
					onUpdate: (s: string) => logs.push(s),
				});
				const peer: ThinkingPeer = { name: "researcher", role: "researcher" };
				// nothing running — safe no-op
				expect(() => rt._stopThinking(peer)).not.toThrow();
				rt._startThinking(peer);
				rt._stopThinking(peer); // before the 500ms delay — no frame drawn
				expect(logs.filter((l) => l === "\r\x1b[K")).toHaveLength(0);
				rt._startThinking(peer);
				vi.advanceTimersByTime(600); // frame drawn
				rt._stopThinking(peer);
				expect(logs.filter((l) => l === "\r\x1b[K")).toHaveLength(1);
			} finally {
				restore();
				vi.useRealTimers();
			}
		});

		it("leaves no pending thinking timers after a completed sequential run (process can exit)", async () => {
			vi.useFakeTimers();
			const restore = stubTTY();
			try {
				const fake = fakeClient("We all agree. [DONE]");
				const rt = createRoundtable({ maxRounds: 1, onUpdate: () => {} });
				rt.start = async () => {
					rt.clients.set("researcher", fake);
					rt.clients.set("developer", fake);
				};
				const runPromise = rt.run();
				// Fire the spinner timeout window and shutdown's 200ms grace period
				await vi.advanceTimersByTimeAsync(1000);
				const result = await runPromise;
				expect(result.consensus).toBe(true);
				expect(vi.getTimerCount()).toBe(0);
				for (const p of rt.peers as ThinkingPeer[]) {
					expect(p._thinkingInterval ?? null).toBeNull();
					expect(p._thinkingTimeout ?? null).toBeNull();
				}
			} finally {
				restore();
				vi.useRealTimers();
			}
		});

		it("stops the orchestrator's thinking animation using the real peer object (orchestrated)", async () => {
			vi.useFakeTimers();
			const restore = stubTTY();
			try {
				const doneAction = { action: "done", summary: "All tasks complete." };
				const fake = fakeClient(JSON.stringify(doneAction));
				const rt = createRoundtable({
					peers: [
						{ name: "orchestrator", role: "orchestrator" },
						{ name: "researcher", role: "researcher" },
					],
					mode: "orchestrated",
					maxRounds: 2,
					onUpdate: () => {},
				});
				rt.start = async () => {
					rt.clients.set("orchestrator", fake);
				};
				const runPromise = rt.run();
				await vi.advanceTimersByTimeAsync(1000);
				const result = await runPromise;
				expect(result.consensus).toBe(true);
				const orch = rt.peers.find(
					(p) => p.name === "orchestrator",
				) as ThinkingPeer;
				expect(orch._thinkingInterval ?? null).toBeNull();
				expect(orch._thinkingTimeout ?? null).toBeNull();
				expect(vi.getTimerCount()).toBe(0);
			} finally {
				restore();
				vi.useRealTimers();
			}
		});
	});
});
