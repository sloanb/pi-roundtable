/**
 * roundtable.mjs — orchestrate N pi RPC peers as a conversation.
 *
 * Usage:
 *   import { Roundtable } from "./lib/roundtable.mjs";
 *   const rt = new Roundtable({ peers, topic, maxRounds, onUpdate });
 *   await rt.run();
 *
 * Design choices:
 *   - One peer speaks at a time (round-robin by default; configurable order).
 *   - Each peer gets a system prompt that establishes its role and tells it
 *     who else is in the room. The transcript is appended to each prompt so
 *     every peer sees the full history.
 *   - "agent_settled" is the signal that a peer is done speaking.
 *   - A peer can yield early by emitting `[YIELD]` as the last token of its
 *     message. Roundtable checks the final assistant text for this and moves
 *     to the next speaker without burning more rounds.
 *   - Referee (optional): a third peer that judges when consensus is reached
 *     and stops the loop with a summary.
 */

import { RpcClient, nextSettled } from "./rpc-client.mjs";

const YIELD_TOKEN = "[YIELD]";
const DONE_TOKEN = "[DONE]";

const ROLE_COLOR = {
	researcher: "\x1b[36m", // cyan
	critic: "\x1b[33m", // yellow
	implementer: "\x1b[32m", // green
	referee: "\x1b[35m", // magenta
	user: "\x1b[2m", // dim
	reset: "\x1b[0m",
};

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
	 * @param {Array<{name:string, role:string, model?:string, systemPrompt?:string, appendSystemPromptPath?:string, tools?:string[]}>} opts.peers
	 * @param {string} opts.topic
	 * @param {number} [opts.maxRounds=12]
	 * @param {boolean} [opts.color=true]
	 * @param {(line:string)=>void} [opts.onUpdate]  - log line callback (for TUI/CLI)
	 * @param {AbortSignal} [opts.signal]
	 * @param {string} [opts.cwd]
	 * @param {boolean} [opts.noSession=true]
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

		this.clients = new Map(); // name -> RpcClient
		this.transcript = []; // [{peer, role, text, round, structured?}]
		this.round = 0;

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

			// If a systemPrompt is supplied, write it to a temp file and use
			// --append-system-prompt so we don't have to re-spawn.
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
			// Track whether the next turn streamed tokens, so the orchestrator
			// knows whether to re-print the full message at end of turn.
			peer._streamedTurn = false;
		}

		this._tmpDirs = tmpDirs;
	}

	_wireLog(client, peer) {
		client.onEvent((evt) => {
			// Suppress streaming when stdout is being captured (e.g. when piped to file).
			// PI_ROUNDTABLE_QUIET=1 forces non-streaming even on a TTY.
			const wantStream =
				process.stdout.isTTY && process.env.PI_ROUNDTABLE_QUIET !== "1";

			if (
				evt.type === "message_update" &&
				evt.assistantMessageEvent?.type === "text_delta"
			) {
				if (wantStream) {
					if (!peer._streamedTurn) {
						// First token: announce who's speaking so the user knows work is happening.
						this._log(this._color(peer.role, `\n💬 ${peer.name} is speaking...\n`));
						peer._streamedTurn = true;
					}
					this._log(this._color(peer.role, evt.assistantMessageEvent.delta));
				}
			}
		});
	}

	async _speak(peer) {
		const client = this.clients.get(peer.name);
		const transcriptText = this.transcript
			.map((t) => `[${t.peer} (${t.role})]: ${t.text}`)
			.join("\n\n");

		const isFirst = this.transcript.length === 0;
		const instruction = isFirst
			? `The topic is:\n\n${this.topic}\n\nYou go first. Open the discussion. End with ${YIELD_TOKEN} when you're ready for the next speaker.`
			: `The discussion so far:\n\n${transcriptText}\n\n---\n\nYour turn to respond. Stay in character. End with ${YIELD_TOKEN} when done. If you believe the discussion has reached a clear conclusion, end with ${DONE_TOKEN} instead and summarize the consensus.`;

		// Race: the agent speaks vs an external abort signal.
		const settledPromise = nextSettled(client);
		const abortPromise = this.signal
			? new Promise((_, reject) =>
					this.signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					}),
				)
			: new Promise(() => {});

		try {
			// Fire and forget — we don't need the command response, we watch
			// the event stream for agent_settled.
			client.send({ type: "prompt", message: instruction });
			await Promise.race([settledPromise, abortPromise]);
		} catch (err) {
			if (err.message === "aborted") throw err;
			throw err;
		}

		// Pull the latest assistant message from the client's history.
		// We do this by sending a get_messages and reading the last assistant text.
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

		// Strip yield/done tokens from the displayed text; keep them as flags.
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

		return { text: display, yielded, done };
	}

	async run() {
		this._log(this._color("user", `\n━━━ TOPIC ━━━\n${this.topic}\n\n`));
		this._log(
			this._color(
				"user",
				`Peers: ${this.peers.map((p) => `${p.name} (${p.role})`).join(", ")}\nRounds: ${this.maxRounds}\n\n`,
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
						`\n━━━ Round ${this.round} ━━━ ${peer.name} (${peer.role}) ━━━\n`,
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
				});
				if (!peer._streamedTurn) {
					// Non-streaming path: print the full message now.
					this._log(`\n${this._color(peer.role, result.text)}\n`);
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
				`\n━━━ END ━━━ ${consensus ? "consensus reached" : "max rounds reached"} ━━━\n`,
			),
		);
		return { transcript: this.transcript, consensus, rounds: this.round };
	}

	async shutdown() {
		for (const [, client] of this.clients) {
			try {
				client.kill();
			} catch {
				/* ignore */
			}
		}
		// give them a moment to flush
		await new Promise((r) => setTimeout(r, 200));
		// clean up temp system-prompt files
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

	/**
	 * Build transcript text for prompts.
	 */
	_buildTranscriptText() {
		if (this.transcript.length === 0) return "";
		return this.transcript
			.map((t) => `[${t.peer} (${t.role})]: ${t.text}`)
			.join("\n\n");
	}

	/**
	 * Build workflow state summary for orchestrator context.
	 */
	_buildStateSummary() {
		return JSON.stringify(this.workflowState, null, 2);
	}

	/**
	 * Get peer list for orchestrator context (excludes orchestrator).
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
	 * Get peer capabilities as JSON string.
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
	 * Apply state update from orchestrator.
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
			this.workflowState.artifacts = {
				...this.workflowState.artifacts,
				...update.artifacts,
			};
		}
	}
}
