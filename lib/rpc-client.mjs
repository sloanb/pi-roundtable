/**
 * rpc-client.mjs — minimal, protocol-correct JSONL client for `pi --mode rpc`.
 *
 * Why hand-rolled instead of `readline`:
 *   pi's RPC mode uses strict JSONL semantics with LF (`\n`) as the only
 *   record delimiter. Node `readline` also splits on U+2028 / U+2029, which
 *   are valid inside JSON strings. Per docs/rpc.md §"Framing", this would
 *   corrupt messages.
 *
 * Public surface:
 *   const client = new RpcClient({ command, args, cwd, env });
 *   await client.start()                              // resolves once stdin/stdout are wired
 *   client.send({ type: "prompt", ... })             // returns Promise<response> if `id` is set
 *   client.onEvent(event)                            // subscribe; returns an unsubscribe fn
 *   client.kill()                                    // SIGTERM, then SIGKILL after 5s
 */

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";

export class RpcClient {
	constructor({ command, args = [], cwd, env, name = "rpc" }) {
		this.command = command;
		this.args = args;
		this.cwd = cwd;
		this.env = env;
		this.name = name;
		this.proc = null;
		this._buffer = "";
		this._decoder = new StringDecoder("utf8");
		this._listeners = new Set();
		this._pending = new Map(); // id -> { resolve, reject }
		this._nextId = 1;
		this._exitInfo = null;
	}

	async start() {
		return new Promise((resolve, reject) => {
			this.proc = spawn(this.command, this.args, {
				cwd: this.cwd,
				env: this.env ?? process.env,
				stdio: ["pipe", "pipe", "pipe"],
				shell: false,
			});

			const onSpawnErr = (err) => {
				reject(new Error(`Failed to spawn ${this.command}: ${err.message}`));
			};
			this.proc.once("error", onSpawnErr);

			// stdout: JSONL events + responses
			this.proc.stdout.on("data", (chunk) => {
				const str = typeof chunk === "string" ? chunk : this._decoder.write(chunk);
				this._buffer += str;
				let nl;
				while ((nl = this._buffer.indexOf("\n")) !== -1) {
					let line = this._buffer.slice(0, nl);
					this._buffer = this._buffer.slice(nl + 1);
					if (line.endsWith("\r")) line = line.slice(0, -1);
					if (line.length > 0) this._dispatch(line);
				}
			});

			// stderr: surfaced to the caller as a single "stderr" event so they can log it
			let stderrBuf = "";
			this.proc.stderr.on("data", (chunk) => {
				stderrBuf += chunk.toString();
			});

			this.proc.on("close", (code, signal) => {
				this._buffer += this._decoder.end();
				if (this._buffer.length > 0) {
					const line = this._buffer.endsWith("\r") ? this._buffer.slice(0, -1) : this._buffer;
					if (line.length > 0) this._dispatch(line);
					this._buffer = "";
				}
				this._exitInfo = { code, signal, stderr: stderrBuf };
				for (const { reject } of this._pending.values()) {
					reject(new Error(`process exited (code=${code}, signal=${signal}) before response`));
				}
				this._pending.clear();
			});

			// "ready" = stdin/stdout are wired. We can't actually detect this
			// portably without a handshake protocol — but pi emits no banner,
			// and the docs treat spawn-then-send as the normal pattern. We
			// resolve immediately and let the caller send a first command.
			this.proc.once("spawn", () => {
				this.proc.off("error", onSpawnErr);
				resolve();
			});

			// Fallback: if `spawn` event never fires (it always does in Node),
			// resolve on next tick so we don't hang.
			setImmediate(() => {
				if (this.proc && this.proc.pid) {
					this.proc.off("error", onSpawnErr);
					resolve();
				}
			});
		});
	}

	_dispatch(line) {
		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch (err) {
			this._emit({ type: "_parse_error", error: err.message, line });
			return;
		}

		// Responses correlate by id; events are fire-and-forget.
		if (parsed.type === "response" && parsed.id != null) {
			const pending = this._pending.get(parsed.id);
			if (pending) {
				this._pending.delete(parsed.id);
				if (parsed.success === false) {
					pending.reject(new Error(parsed.error || `command ${parsed.command} failed`));
				} else {
					pending.resolve(parsed);
				}
			}
		}

		this._emit(parsed);
	}

	_emit(event) {
		for (const fn of this._listeners) {
			try {
				fn(event);
			} catch (err) {
				console.error(`[${this.name}] listener error:`, err);
			}
		}
	}

	onEvent(fn) {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}

	/**
	 * Send a command. If it has an `id`, returns a Promise that resolves with
	 * the response. If not, returns immediately (fire-and-forget events).
	 */
	send(cmd) {
		if (!this.proc || !this.proc.stdin.writable) {
			return Promise.reject(new Error("client not started or stdin closed"));
		}
		const id = cmd.id ?? (cmd.type !== "prompt" && cmd.type !== "steer" ? `req-${this._nextId++}` : null);
		const payload = id ? { ...cmd, id } : cmd;
		const line = JSON.stringify(payload) + "\n";
		this.proc.stdin.write(line);

		if (id) {
			return new Promise((resolve, reject) => {
				this._pending.set(id, { resolve, reject });
			});
		}
		return undefined;
	}

	kill() {
		if (!this.proc) return;
		this.proc.kill("SIGTERM");
		setTimeout(() => {
			if (this.proc && !this.proc.killed) this.proc.kill("SIGKILL");
		}, 5000);
	}

	get exitInfo() {
		return this._exitInfo;
	}

	get pid() {
		return this.proc?.pid;
	}
}

/**
 * Convenience: wait until the next `agent_settled` event arrives.
 * Use to know "this speaker is done, time to hand the floor to the next."
 */
export function nextSettled(client) {
	return new Promise((resolve) => {
		const off = client.onEvent((evt) => {
			if (evt.type === "agent_settled") {
				off();
				resolve();
			}
		});
	});
}