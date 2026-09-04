import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RpcClient } from "../lib/rpc-client.mjs";

const fixture = path.resolve(
	fileURLToPath(import.meta.url),
	"../fixtures/mock-pi.mjs",
);

describe("RpcClient against mock-pi fixture", () => {
	let client: RpcClient | undefined;

	afterEach(() => {
		client?.kill();
		client = undefined;
	});

	it("correlates a single request/response", async () => {
		client = new RpcClient({
			command: process.execPath,
			args: [fixture],
			name: "mock",
		});
		await client.start();

		const resp = await client.send({ type: "get_messages" });

		expect(resp).toMatchObject({ type: "response", success: true });
		expect((resp as any).data.messages[0].content[0].text).toBe("mock response");
	});

	it("correlates concurrent requests by id", async () => {
		client = new RpcClient({
			command: process.execPath,
			args: [fixture],
			name: "mock",
		});
		await client.start();

		const [a, b] = await Promise.all([
			client.send({ type: "get_messages", id: "a" }),
			client.send({ type: "get_messages", id: "b" }),
		]);

		expect((a as any).id).toBe("a");
		expect((b as any).id).toBe("b");
	});

	it("emits streaming events for a prompt", async () => {
		client = new RpcClient({
			command: process.execPath,
			args: [fixture],
			name: "mock",
		});
		await client.start();

		const deltas: string[] = [];
		const off = client.onEvent((evt) => {
			if (
				evt.type === "message_update" &&
				evt.assistantMessageEvent?.type === "text_delta"
			) {
				deltas.push(evt.assistantMessageEvent.delta);
			}
		});

		client.send({ type: "prompt", message: "hello" });
		await new Promise((resolve) => {
			const settledOff = client!.onEvent((evt) => {
				if (evt.type === "agent_settled") {
					settledOff();
					resolve(undefined);
				}
			});
		});
		off();

		expect(deltas.join("")).toBe("mock output");
	});

	it("surfaces malformed lines as _parse_error events", async () => {
		client = new RpcClient({
			command: process.execPath,
			args: [fixture],
			env: { ...process.env, MOCK_PI_MALFORMED: "true" },
			name: "mock",
		});
		await client.start();

		const errors: unknown[] = [];
		const off = client.onEvent((evt) => {
			if (evt.type === "_parse_error") errors.push(evt);
		});

		const resp = await client.send({ type: "get_messages", id: 1 });
		off();

		expect((resp as any).success).toBe(true);
		expect(errors.length).toBeGreaterThan(0);
	});
});
