#!/usr/bin/env node
/**
 * mock-pi.mjs — minimal JSONL peer for RpcClient integration tests.
 *
 * Behaviour knobs (via environment):
 *   MOCK_PI_DELAY_MS      — delay every response by N ms
 *   MOCK_PI_MALFORMED=true — emit a non-JSON line before the real response
 *   MOCK_PI_CLOSE_AFTER=N — exit after N processed requests
 *   MOCK_PI_ERROR=msg     — reply with success:false and the given error
 */
import { StringDecoder } from "node:string_decoder";

const delayMs = Number(process.env.MOCK_PI_DELAY_MS || "0");
const malformed = process.env.MOCK_PI_MALFORMED === "true";
const closeAfter = Number(process.env.MOCK_PI_CLOSE_AFTER || "0");
const errorResponse = process.env.MOCK_PI_ERROR;

let buffer = "";
let processed = 0;
const decoder = new StringDecoder("utf8");

function writeLine(obj) {
	return new Promise((resolve) => {
		process.stdout.write(JSON.stringify(obj) + "\n", () => resolve(undefined));
	});
}

async function handleRequest(req) {
	processed++;
	if (delayMs > 0) {
		await new Promise((r) => setTimeout(r, delayMs));
	}

	if (malformed) {
		process.stdout.write("this is not valid json\n");
	}

	if (req.type === "get_messages") {
		const resp = {
			type: "response",
			id: req.id,
			success: true,
			data: {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "mock response" }],
					},
				],
			},
		};
		if (errorResponse) {
			resp.success = false;
			resp.error = errorResponse;
			delete resp.data;
		}
		await writeLine(resp);
	} else if (req.type === "prompt") {
		await writeLine({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "mock " },
		});
		await writeLine({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "output" },
		});
		await writeLine({ type: "agent_settled" });
		if (req.id != null) {
			await writeLine({ type: "response", id: req.id, success: true });
		}
	} else {
		await writeLine({
			type: "response",
			id: req.id,
			success: false,
			error: `unknown method: ${req.type}`,
		});
	}

	if (closeAfter > 0 && processed >= closeAfter) {
		process.exit(0);
	}
}

process.stdin.on("data", (chunk) => {
	buffer += decoder.write(chunk);
	let nl;
	while ((nl = buffer.indexOf("\n")) !== -1) {
		let line = buffer.slice(0, nl);
		buffer = buffer.slice(nl + 1);
		if (line.endsWith("\r")) line = line.slice(0, -1);
		if (!line) continue;

		let req;
		try {
			req = JSON.parse(line);
		} catch {
			process.stdout.write(JSON.stringify({ type: "_parse_error", line }) + "\n");
			continue;
		}

		handleRequest(req).catch((err) => {
			console.error(err);
			process.exit(1);
		});
	}
});

process.stdin.on("end", () => {
	buffer += decoder.end();
});
