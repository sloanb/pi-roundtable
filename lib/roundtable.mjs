/**
 * roundtable.mjs — orchestrate N pi RPC peers as a conversation.
 *
 * Usage:
 *   import { Roundtable } from "./lib/roundtable.mjs";
 *   const rt = new Roundtable({ peers, topic, maxRounds, onUpdate, mode });
 *   await rt.run();
 *
 * Modes:
 *   - "sequential": round-robin conversation (legacy, default)
 *   - "orchestrated": orchestrator routes tasks to peers based on capabilities
 */

import { RpcClient, nextSettled } from "./rpc-client.mjs";
import { prettyAgentOutput, prettyPeerReport } from "./pretty.mjs";

const YIELD_TOKEN = "[YIELD]";
const DONE_TOKEN = "[DONE]";

const ROLE_COLOR = {
	researcher: "\x1b[36m", // cyan
	critic: "\x1b[33m", // yellow
	implementer: "\x1b[32m", // green
	developer: "\x1b[34m", // blue
	"code-reviewer": "\x1b[35m", // magenta
	committer: "\x1b[31m", // red
	releaser: "\x1b[33m", // yellow (bright)
	orchestrator: "\x1b[96m", // bright cyan
	referee: "\x1b[35m", // magenta
	user: "\x1b[2m", // dim
	reset: "\x1b[0m",
};

const ROLE_ICON = {
	researcher: "🔍",
	critic: "🔎",
	implementer: "🛠️",
	developer: "💻",
	"code-reviewer": "📝",
	committer: "📦",
	releaser: "🚀",
	orchestrator: "🎯",
	referee: "⚖️",
	user: "👤",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function colorize(role, text) {
	const c = ROLE_COLOR[role] ?? "\x1b[37m";
	return `${c}${text}${ROLE_COLOR.reset}`;
}

/**
 * Parse JSON from agent output, extracting the first valid JSON object.
 * Agents may wrap JSON in markdown code fences or include extra text.
 */
export function parseAgentJSON(text) {
	// Try to find JSON in markdown code fence
	const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
	if (fenceMatch) {
		try {
			return JSON.parse(fenceMatch[1]);
		} catch {
			// fall through
		}
	}
	// Try to find bare JSON object
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[0]);
		} catch {
			// fall through
		}
	}
	return null;
}

/**
 * Validate orchestrator action object.
 */
export function validateOrchestratorAction(obj) {
	if (!obj || typeof obj !== "object") return false;
	if (!["route", "done", "fallback"].includes(obj.action)) return false;
	if (obj.action === "route") {
		return (
			typeof obj.next_peer === "string" &&
			typeof obj.instruction === "string" &&
			typeof obj.reason === "string" &&
			typeof obj.expected_output === "string"
		);
	}
	if (obj.action === "done") {
		return typeof obj.summary === "string";
	}
	if (obj.action === "fallback") {
		return typeof obj.reason === "string";
	}
	return false;
}

/**
 * Validate peer report object.
 */
export function validatePeerReport(obj) {
	if (!obj || typeof obj !== "object") return false;
	return (
		["complete", "needs_input", "blocked", "error"].includes(obj.status) &&
		typeof obj.findings === "string" &&
		Array.isArray(obj.artifacts) &&
		(typeof obj.recommended_next_peer === "string" ||
			obj.recommended_next_peer === null)
	);
}

export class Roundtable {
	/**
	 * @param {object} opts
	 * @param {Array<{name:string, role:string, model?:string, systemPrompt?:string, appendSystemPromptPath?:string, tools?:string[], capabilities?:string[]}>} opts.peers
	 * @param {string} opts.topic
	 * @param {number} [opts.maxRounds=12]
	 * @param {boolean} [opts.color=true]
	 * @param {(line:string)=>void} [opts.onUpdate]  - log line callback (for TUI/CLI)
	 * @param {AbortSignal} [opts.signal]
	 * @param {string} [opts.cwd]
	 * @param {boolean} [opts.noSession=true]
	 * @param {boolean} [opts.pretty=true] - pretty-print JSON in console
	 * @param {boolean} [opts.compact=false] - compact mode for long conversations
	 * @param {boolean} [opts.showTiming=true] - show turn timing
	 * @param {boolean} [opts.showThinking=true] - show thinking animation
	 */
	constructor(opts) {
		this.peers = opts.peers;
		this.topic = opts.topic;
		this.maxRounds = opts.maxRounds ?? 12;
		this.color = opts.color ?? true;
		this.onUpdate = opts.onUpdate ?? ((s) => process.stdout.write(s));
		this.signal = opts.signal;
		this.cwd = opts.cwd ?? process.cwd();
		this.noSession = opts.noSession ?? true;
		this.mode = opts.mode ?? "sequential";
		this.pretty = opts.pretty ?? true;
		this.compactMode = opts.compact ?? false;
		this.showTiming = opts.showTiming ?? true;
		this.showThinking = opts.showThinking ?? true;

		this.clients = new Map(); // name -> RpcClient
		this.transcript = []; // [{peer, role, text, round, structured?, durationMs?}]
		this.round = 0;
		this.turnStartTime = 0;

		// Orchestrator state
		this.workflowState = {
			completed_tasks: [],
			pending_tasks: [],
			blocked_tasks: [],
			artifacts: {},
			visit_counts: {}, // peer -> count
			last_peer: null,
			consecutive_routes: 0,
		};
	}

	_log(line) {
		this.onUpdate(line);
	}

	_color(role, text) {
		if (!this.color) return text;
		return colorize(role, text);
	}

	async start() {
		const fs = await import("node:fs/promises");
		const os = await import("node:os");
		const path = await import("node:path");

		const tmpDirs = [];

		for (const peer of this.peers) {
			const peerTools = peer.tools ?? ["read", "bash", "edit", "write"];
			const args = [
				"--mode",
				"rpc",
				"--no-session",
				"--provider",
				peer.model?.split("/")[0] ?? "ollama-cloud",
				"--model",
				peer.model ?? "ollama-cloud/glm-5.3-flash",
				"--tools",
				peerTools.join(","),
				"--name",
				peer.name,
			];

			if (peer.systemPrompt && !peer.appendSystemPromptPath) {
				const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-peer-"));
				const file = path.join(dir, `${peer.name}.md`);
				await fs.writeFile(file, peer.systemPrompt, { mode: 0o600 });
				peer.appendSystemPromptPath = file;
				tmpDirs.push(dir);
			}
			if (peer.appendSystemPromptPath) {
				args.push("--append-system-prompt", peer.appendSystemPromptPath);
			}

			const client = new RpcClient({
				command: "pi",
				args,
				cwd: this.cwd,
				name: peer.name,
			});

			this._wireLog(client, peer);
			await client.start();
			this.clients.set(peer.name, client);
			peer._streamedTurn = false;
			peer._thinkingInterval = null;
			peer._firstTokenReceived = false;
		}

		this._tmpDirs = tmpDirs;
	}

	_wireLog(client, peer) {
		client.onEvent((evt) => {
			const wantStream =
				process.stdout.isTTY &&
				process.env.PI_ROUNDTABLE_QUIET !== "1" &&
				!this.pretty;

			if (
				evt.type === "message_update" &&
				evt.assistantMessageEvent?.type === "text_delta"
			) {
				if (wantStream) {
					if (!peer._firstTokenReceived) {
						// Stop thinking animation
						if (peer._thinkingInterval) {
							clearInterval(peer._thinkingInterval);
							peer._thinkingInterval = null;
							// Clear the thinking line
							this._log("\r\x1b[K");
						}
						peer._firstTokenReceived = true;
						peer._streamedTurn = true;
					}
					this._log(this._color(peer.role, evt.assistantMessageEvent.delta));
				}
			}
		});

		// Cleanup on client end
		const originalKill = client.kill.bind(client);
		client.kill = () => {
			if (peer._thinkingInterval) {
				clearInterval(peer._thinkingInterval);
				peer._thinkingInterval = null;
				this._log("\r\x1b[K"); // Clear thinking line
			}
			return originalKill();
		};
	}

	/**
	 * Build the transcript text for context.
	 */
	_buildTranscriptText() {
		return this.transcript
			.map((t) => `[${t.peer} (${t.role})]: ${t.text}`)
			.join("\n\n");
	}

	/**
	 * Build workflow state summary for orchestrator context.
	 */
	_buildStateSummary() {
		const {
			completed_tasks,
			pending_tasks,
			blocked_tasks,
			artifacts,
			visit_counts,
		} = this.workflowState;
		return JSON.stringify(
			{
				completed_tasks,
				pending_tasks,
				blocked_tasks,
				artifacts: Object.keys(artifacts),
				visit_counts,
			},
			null,
			2,
		);
	}

	/**
	 * Get peer capabilities for orchestrator context.
	 */
	_getPeerCapabilities() {
		const caps = {};
		for (const peer of this.peers) {
			if (peer.capabilities) {
				caps[peer.name] = peer.capabilities;
			}
		}
		return JSON.stringify(caps, null, 2);
	}

	/**
	 * Get peer list for orchestrator context.
	 */
	_getPeerList() {
		return this.peers
			.map((p) => ({
				name: p.name,
				role: p.role,
				capabilities: p.capabilities ?? [],
			}))
			.filter((p) => p.name !== "orchestrator");
	}

	/**
	 * Build the instruction for the orchestrator.
	 */
	_buildOrchestratorInstruction(isFirst) {
		const transcriptText = this._buildTranscriptText();
		const stateSummary = this._buildStateSummary();
		const peerCapabilities = this._getPeerCapabilities();
		const peerList = JSON.stringify(this._getPeerList(), null, 2);

		if (isFirst) {
			return `You are the Orchestrator. The topic is:

${this.topic}

Available peers and their capabilities:
${peerCapabilities}

Peer list:
${peerList}

Current workflow state:
${stateSummary}

This is the first turn. Decide which peer should act first and give them a specific instruction.

Your response MUST be a single JSON object with this schema:
{
  "action": "route" | "done" | "fallback",
  "next_peer": "peer-name",
  "instruction": "Specific task for the peer",
  "reason": "Why this peer, why now",
  "expected_output": "What the peer should produce",
  "state_update": {
    "completed_tasks": [],
    "pending_tasks": [],
    "blocked_tasks": [],
    "artifacts": {}
  }
}

Or for completion:
{
  "action": "done",
  "summary": "One-paragraph summary",
  "final_artifacts": {}
}

Or for fallback:
{
  "action": "fallback",
  "reason": "Why routing failed"
}`;
		}

		return `You are the Orchestrator. The topic is:

${this.topic}

Available peers and their capabilities:
${peerCapabilities}

Peer list:
${peerList}

Current workflow state:
${stateSummary}

Full transcript so far:
${transcriptText}

The last peer has completed their task. Decide the next action.

Your response MUST be a single JSON object with the same schema as above.`;
	}

	/**
	 * Build the instruction for a worker peer.
	 */
	_buildPeerInstruction(_peer, orchestratorInstruction, isFirst) {
		const transcriptText = this._buildTranscriptText();

		if (isFirst && this.mode === "sequential") {
			return `The topic is:\n\n${this.topic}\n\nYou go first. Open the discussion. End with ${YIELD_TOKEN} when you're ready for the next speaker.`;
		}

		const base = `The discussion so far:\n\n${transcriptText}\n\n---\n\n`;

		if (orchestratorInstruction) {
			return (
				base +
				`The Orchestrator has routed this task to you:\n\n` +
				`**Instruction:** ${orchestratorInstruction.instruction}\n\n` +
				`**Expected output:** ${orchestratorInstruction.expected_output}\n\n` +
				`Respond with a structured report in JSON format:\n` +
				`{\n` +
				`  "status": "complete" | "needs_input" | "blocked" | "error",\n` +
				`  "findings": "Your findings, analysis, or work product",\n` +
				`  "artifacts": ["file1", "file2", ...],\n` +
				`  "recommended_next_peer": "peer-name" | null\n` +
				`}\n\n` +
				`End with [YIELD] when done.`
			);
		}

		// Sequential mode fallback
		return (
			base +
			`Your turn to respond. Stay in character. End with ${YIELD_TOKEN} when done. If you believe the discussion has reached a clear conclusion, end with ${DONE_TOKEN} instead and summarize the consensus.`
		);
	}

	/**
	 * Speak as the orchestrator.
	 */
	async _speakOrchestrator() {
		const client = this.clients.get("orchestrator");
		const isFirst = this.transcript.length === 0;
		const instruction = this._buildOrchestratorInstruction(isFirst);

		this.turnStartTime = Date.now();
		this._startThinking({ name: "orchestrator", role: "orchestrator" });
		const settledPromise = nextSettled(client);
		const abortPromise = this.signal
			? new Promise((_, reject) =>
					this.signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					}),
				)
			: new Promise(() => {});

		try {
			client.send({ type: "prompt", message: instruction });
			await Promise.race([settledPromise, abortPromise]);
		} catch (err) {
			if (err.message === "aborted") throw err;
			throw err;
		}

		const durationMs = Date.now() - this.turnStartTime;

		const messagesResp = await client.send({ type: "get_messages" });
		const messages = messagesResp?.data?.messages ?? messagesResp?.messages ?? [];
		let finalText = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role === "assistant") {
				for (const part of m.content ?? []) {
					if (part.type === "text") {
						finalText = part.text;
						break;
					}
				}
				if (finalText) break;
			}
		}

		return { text: finalText, durationMs };
	}

	/**
	 * Speak as a worker peer.
	 */
	async _speakPeer(peer, orchestratorInstruction) {
		const client = this.clients.get(peer.name);
		const isFirst = this.transcript.length === 0;
		const instruction = this._buildPeerInstruction(
			peer,
			orchestratorInstruction,
			isFirst,
		);

		this.turnStartTime = Date.now();
		this._startThinking(peer);
		const settledPromise = nextSettled(client);
		const abortPromise = this.signal
			? new Promise((_, reject) =>
					this.signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					}),
				)
			: new Promise(() => {});

		try {
			client.send({ type: "prompt", message: instruction });
			await Promise.race([settledPromise, abortPromise]);
		} catch (err) {
			if (err.message === "aborted") throw err;
			throw err;
		}

		const durationMs = Date.now() - this.turnStartTime;

		const messagesResp = await client.send({ type: "get_messages" });
		const messages = messagesResp?.data?.messages ?? messagesResp?.messages ?? [];
		let finalText = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role === "assistant") {
				for (const part of m.content ?? []) {
					if (part.type === "text") {
						finalText = part.text;
						break;
					}
				}
				if (finalText) break;
			}
		}

		// Strip yield/done tokens
		let yielded = false;
		let done = false;
		let display = finalText;
		if (display.includes(DONE_TOKEN)) {
			done = true;
			display = display.replace(DONE_TOKEN, "").trim();
		} else if (display.includes(YIELD_TOKEN)) {
			yielded = true;
			display = display.replace(YIELD_TOKEN, "").trim();
		}

		// Try to parse structured report
		let structured = null;
		if (this.mode === "orchestrated") {
			const parsed = parseAgentJSON(finalText);
			if (parsed && validatePeerReport(parsed)) {
				structured = parsed;
			}
		}

		return { text: display, yielded, done, structured, durationMs };
	}

	/**
	 * Update workflow state from orchestrator action.
	 */
	_applyStateUpdate(update) {
		if (!update) return;
		if (update.completed_tasks)
			this.workflowState.completed_tasks = update.completed_tasks;
		if (update.pending_tasks)
			this.workflowState.pending_tasks = update.pending_tasks;
		if (update.blocked_tasks)
			this.workflowState.blocked_tasks = update.blocked_tasks;
		if (update.artifacts) {
			for (const [k, v] of Object.entries(update.artifacts)) {
				this.workflowState.artifacts[k] = v;
			}
		}
	}

	/**
	 * Run in sequential (legacy) mode.
	 */
	async _runSequential() {
		this._log(this._color("user", `\n━━━ TOPIC ━━━\n${this.topic}\n\n`));
		this._log(
			this._color(
				"user",
				`Peers: ${this.peers.map((p) => `${p.name} (${p.role})`).join(", ")}\nRounds: ${this.maxRounds}\nMode: sequential\n\n`,
			),
		);

		await this.start();

		const order = this.peers.map((p) => p.name);
		let cursor = 0;
		let consensus = false;

		try {
			while (this.round < this.maxRounds && !consensus) {
				this.round++;
				const peerName = order[cursor % order.length];
				const peer = this.peers.find((p) => p.name === peerName);

				this._log(
					this._color(
						"user",
						`\n${this._buildRoundHeader(this.round, peer, this.maxRounds)}\n`,
					),
				);

				let result;
				try {
					result = await this._speak(peer);
				} catch (err) {
					this._log(this._color("critic", `\n[error: ${err.message}]\n`));
					break;
				}

				this.transcript.push({
					peer: peer.name,
					role: peer.role,
					text: result.text,
					round: this.round,
					durationMs: result.durationMs,
				});
				if (!peer._streamedTurn) {
					this._log(`\n${this._color(peer.role, result.text)}\n`);
				}
				if (this.showTiming && result.durationMs) {
					this._log(
						this._color("user", `  ⏱  ${this._formatDuration(result.durationMs)}\n`),
					);
				}
				peer._streamedTurn = false;

				if (result.done) {
					consensus = true;
					break;
				}

				cursor++;
			}
		} finally {
			await this.shutdown();
		}

		this._log(
			this._color(
				"user",
				`\n${this._buildEndBanner(consensus, this.round, this.transcript)}\n`,
			),
		);
		return { transcript: this.transcript, consensus, rounds: this.round };
	}

	/**
	 * Run in orchestrated mode.
	 */
	async _runOrchestrated() {
		this._log(this._color("user", `\n━━━ TOPIC ━━━\n${this.topic}\n\n`));
		this._log(
			this._color(
				"user",
				`Peers: ${this.peers.map((p) => `${p.name} (${p.role})`).join(", ")}\nRounds: ${this.maxRounds}\nMode: orchestrated\n\n`,
			),
		);

		await this.start();

		let consensus = false;

		try {
			while (this.round < this.maxRounds && !consensus) {
				this.round++;

				// Orchestrator's turn
				this._log(
					this._color(
						"user",
						`\n${this._buildRoundHeader(this.round, { name: "orchestrator", role: "orchestrator" }, this.maxRounds)}\n`,
					),
				);

				let orchestratorResult;
				try {
					orchestratorResult = await this._speakOrchestrator();
				} catch (err) {
					this._log(
						this._color("critic", `\n[orchestrator error: ${err.message}]\n`),
					);
					break;
				}

				// Parse orchestrator JSON
				const orchestratorAction = parseAgentJSON(orchestratorResult.text);
				if (
					!orchestratorAction ||
					!validateOrchestratorAction(orchestratorAction)
				) {
					this._log(
						this._color(
							"critic",
							`\n[orchestrator: invalid JSON response, falling back]\n`,
						),
					);
					// Fallback to round-robin
					const order = this.peers
						.filter((p) => p.name !== "orchestrator")
						.map((p) => p.name);
					const peerName = order[this.round % order.length];
					const peer = this.peers.find((p) => p.name === peerName);
					const result = await this._speakPeer(peer, null);
					this._recordTurn(peer, result);
					if (result.done) consensus = true;
					continue;
				}

				// Display orchestrator decision (human-readable)
				this._displayOrchestratorDecision(orchestratorAction);

				this.transcript.push({
					peer: "orchestrator",
					role: "orchestrator",
					text: orchestratorResult.text,
					round: this.round,
					structured: orchestratorAction,
				});

				// Handle orchestrator action
				if (orchestratorAction.action === "done") {
					consensus = true;
					this._log(this._color("user", `\n${orchestratorAction.summary}\n`));
					break;
				}

				if (orchestratorAction.action === "fallback") {
					this._log(
						this._color(
							"critic",
							`\n[orchestrator fallback: ${orchestratorAction.reason}]\n`,
						),
					);
					// Fallback to round-robin for this round
					const order = this.peers
						.filter((p) => p.name !== "orchestrator")
						.map((p) => p.name);
					const peerName = order[this.round % order.length];
					const peer = this.peers.find((p) => p.name === peerName);
					const result = await this._speakPeer(peer, null);
					this._recordTurn(peer, result);
					if (result.done) consensus = true;
					continue;
				}

				// Route action
				const nextPeerName = orchestratorAction.next_peer;
				const nextPeer = this.peers.find((p) => p.name === nextPeerName);

				if (!nextPeer) {
					this._log(
						this._color(
							"critic",
							`\n[orchestrator: unknown peer '${nextPeerName}', falling back]\n`,
						),
					);
					const order = this.peers
						.filter((p) => p.name !== "orchestrator")
						.map((p) => p.name);
					const peerName = order[this.round % order.length];
					const peer = this.peers.find((p) => p.name === peerName);
					const result = await this._speakPeer(peer, null);
					this._recordTurn(peer, result);
					if (result.done) consensus = true;
					continue;
				}

				// Update visit counts
				this.workflowState.visit_counts[nextPeerName] =
					(this.workflowState.visit_counts[nextPeerName] || 0) + 1;
				if (this.workflowState.last_peer === nextPeerName) {
					this.workflowState.consecutive_routes++;
				} else {
					this.workflowState.consecutive_routes = 1;
				}
				this.workflowState.last_peer = nextPeerName;

				// Check consecutive route limit
				if (this.workflowState.consecutive_routes >= 3) {
					this._log(
						this._color(
							"critic",
							`\n[orchestrator: ${nextPeerName} routed 3x consecutively, forcing rotation]\n`,
						),
					);
					// Find a different peer
					const alternatives = this.peers
						.filter((p) => p.name !== "orchestrator" && p.name !== nextPeerName)
						.map((p) => p.name);
					if (alternatives.length > 0) {
						const altName = alternatives[0];
						const altPeer = this.peers.find((p) => p.name === altName);
						const result = await this._speakPeer(altPeer, orchestratorAction);
						this._recordTurn(altPeer, result, orchestratorAction);
						continue;
					}
				}

				// Apply state update from orchestrator
				this._applyStateUpdate(orchestratorAction.state_update);

				// Worker peer's turn
				this._log(
					this._color(
						"user",
						`\n${this._buildRoundHeader(this.round, nextPeer, this.maxRounds, "worker")}\n`,
					),
				);

				let workerResult;
				try {
					workerResult = await this._speakPeer(nextPeer, orchestratorAction);
				} catch (err) {
					this._log(this._color("critic", `\n[worker error: ${err.message}]\n`));
					break;
				}

				this._recordTurn(nextPeer, workerResult, orchestratorAction);

				// Check if worker signals done (shouldn't happen in orchestrated mode, but safety)
				if (workerResult.done) {
					consensus = true;
					break;
				}
			}
		} finally {
			await this.shutdown();
		}

		this._log(
			this._color(
				"user",
				`\n${this._buildEndBanner(consensus, this.round, this.transcript)}\n`,
			),
		);
		return { transcript: this.transcript, consensus, rounds: this.round };
	}

	/**
	 * Display orchestrator decision in human-readable format.
	 */
	_displayOrchestratorDecision(action) {
		if (this.pretty) {
			const { pretty } = prettyAgentOutput(
				JSON.stringify(action),
				"orchestrator",
				this.color,
			);
			this._log(pretty + "\n");
		} else if (action.action === "route") {
			this._log(
				this._color("orchestrator", `🎯 Routing to ${action.next_peer}\n`),
			);
			this._log(this._color("orchestrator", `   Reason: ${action.reason}\n`));
			this._log(
				this._color("orchestrator", `   Expected: ${action.expected_output}\n`),
			);
		}
	}

	/**
	 * Record a turn in the transcript.
	 */
	_recordTurn(peer, result, orchestratorAction) {
		this.transcript.push({
			peer: peer.name,
			role: peer.role,
			text: result.text,
			round: this.round,
			durationMs: result.durationMs,
			structured: result.structured,
			orchestrator_action: orchestratorAction
				? {
						next_peer: orchestratorAction.next_peer,
						instruction: orchestratorAction.instruction,
					}
				: null,
		});

		if (!peer._streamedTurn) {
			if (this.pretty && result.structured) {
				const { pretty } = prettyPeerReport(
					result.text,
					peer.name,
					peer.role,
					this.color,
				);
				this._log(`\n${pretty}\n`);
			} else {
				this._log(`\n${this._color(peer.role, result.text)}\n`);
			}
		}
		if (this.showTiming && result.durationMs) {
			this._log(
				this._color("user", `  ⏱  ${this._formatDuration(result.durationMs)}\n`),
			);
		}
		peer._streamedTurn = false;
	}

	/**
	 * Original _speak for sequential mode (kept for backward compatibility).
	 */
	async _speak(peer) {
		const client = this.clients.get(peer.name);
		const transcriptText = this._buildTranscriptText();

		const isFirst = this.transcript.length === 0;
		const instruction = isFirst
			? `The topic is:\n\n${this.topic}\n\nYou go first. Open the discussion. End with ${YIELD_TOKEN} when you're ready for the next speaker.`
			: `The discussion so far:\n\n${transcriptText}\n\n---\n\nYour turn to respond. Stay in character. End with ${YIELD_TOKEN} when done. If you believe the discussion has reached a clear conclusion, end with ${DONE_TOKEN} instead and summarize the consensus.`;

		this.turnStartTime = Date.now();
		this._startThinking(peer);
		const settledPromise = nextSettled(client);
		const abortPromise = this.signal
			? new Promise((_, reject) =>
					this.signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					}),
				)
			: new Promise(() => {});

		try {
			client.send({ type: "prompt", message: instruction });
			await Promise.race([settledPromise, abortPromise]);
		} catch (err) {
			if (err.message === "aborted") throw err;
			throw err;
		}

		const durationMs = Date.now() - this.turnStartTime;

		const messagesResp = await client.send({ type: "get_messages" });
		const messages = messagesResp?.data?.messages ?? messagesResp?.messages ?? [];
		let finalText = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role === "assistant") {
				for (const part of m.content ?? []) {
					if (part.type === "text") {
						finalText = part.text;
						break;
					}
				}
				if (finalText) break;
			}
		}

		let yielded = false;
		let done = false;
		let display = finalText;
		if (display.includes(DONE_TOKEN)) {
			done = true;
			display = display.replace(DONE_TOKEN, "").trim();
		} else if (display.includes(YIELD_TOKEN)) {
			yielded = true;
			display = display.replace(YIELD_TOKEN, "").trim();
		}

		return { text: display, yielded, done, durationMs };
	}

	_startThinking(peer) {
		if (
			!this.showThinking ||
			!process.stdout.isTTY ||
			process.env.PI_ROUNDTABLE_QUIET === "1"
		)
			return;
		peer._firstTokenReceived = false;
		peer._thinkingInterval = null;
		setTimeout(() => {
			if (!peer._firstTokenReceived && !peer._thinkingInterval) {
				let frame = 0;
				peer._thinkingInterval = setInterval(() => {
					if (peer._firstTokenReceived) {
						clearInterval(peer._thinkingInterval);
						peer._thinkingInterval = null;
						return;
					}
					const icon = ROLE_ICON[peer.role] ?? "🤖";
					const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
					frame++;
					this._log(
						`\r\x1b[K${this._color(peer.role, `${spinner} ${icon} ${peer.name} is thinking...`)}`,
					);
				}, 100);
			}
		}, 500);
	}

	async run() {
		if (this.mode === "orchestrated") {
			return this._runOrchestrated();
		}
		return this._runSequential();
	}

	_buildRoundHeader(round, peer, maxRounds, suffix = "") {
		const icon = ROLE_ICON[peer.role] ?? "🤖";
		const suffixStr = suffix ? ` ${suffix}` : "";
		if (this.compactMode) {
			return `━ Round ${round}/${maxRounds} ━ ${icon} ${peer.name} (${peer.role})${suffixStr} ━`;
		}
		return `━━━ Round ${round}/${maxRounds} ━━━ ${icon} ${peer.name} (${peer.role})${suffixStr} ━━━`;
	}

	_formatDuration(ms) {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		const minutes = Math.floor(ms / 60000);
		const seconds = Math.floor((ms % 60000) / 1000);
		return `${minutes}m ${seconds}s`;
	}

	_buildEndBanner(consensus, rounds, transcript) {
		const totalTurns = transcript.length;
		const totalTime = transcript.reduce((sum, t) => sum + (t.durationMs || 0), 0);
		const avgTime = totalTurns > 0 ? totalTime / totalTurns : 0;

		// Peer participation stats
		const participation = {};
		for (const t of transcript) {
			if (!participation[t.peer]) {
				participation[t.peer] = { count: 0, totalMs: 0, role: t.role };
			}
			participation[t.peer].count++;
			participation[t.peer].totalMs += t.durationMs || 0;
		}
		const participationLines = Object.entries(participation)
			.sort((a, b) => b[1].count - a[1].count)
			.map(
				([peer, stats]) =>
					`${ROLE_ICON[stats.role] ?? "🤖"} ${peer}: ${stats.count} turn${stats.count === 1 ? "" : "s"} (${this._formatDuration(stats.totalMs)})`,
			)
			.join("  |  ");

		if (this.compactMode) {
			const status = consensus ? "✅ consensus" : "⏱ max rounds";
			return `━━━ END ━━━ ${status} • ${rounds} rounds • ${totalTurns} turns • ${this._formatDuration(totalTime)} total ━━━`;
		}

		const status = consensus ? "consensus reached" : "max rounds reached";
		return `━━━ END ━━━ ${status} ━━━\n   Rounds: ${rounds}  Turns: ${totalTurns}  Total time: ${this._formatDuration(totalTime)}  Avg/turn: ${this._formatDuration(avgTime)}\n   Participation: ${participationLines}`;
	}

	async shutdown() {
		for (const [, client] of this.clients) {
			try {
				client.kill();
			} catch {
				/* ignore */
			}
		}
		await new Promise((r) => setTimeout(r, 200));
		if (this._tmpDirs) {
			const fs = await import("node:fs/promises");
			for (const dir of this._tmpDirs) {
				try {
					await fs.rm(dir, { recursive: true, force: true });
				} catch {
					/* ignore */
				}
			}
		}
	}
}
