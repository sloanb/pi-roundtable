import { describe, it, expect } from "vitest";
import { RpcClient, nextSettled } from "../lib/rpc-client.mjs";

describe("RpcClient helpers", () => {
	it("nextSettled resolves when an agent_settled event arrives", async () => {
		const listeners = new Set<(event: unknown) => void>();
		const mockClient = {
			onEvent(fn: (event: unknown) => void) {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		} as unknown as RpcClient;

		const settled = nextSettled(mockClient);

		// Simulate the upstream client emitting the settled event.
		for (const fn of listeners) {
			fn({ type: "agent_settled" });
		}

		await expect(settled).resolves.toBeUndefined();
		expect(listeners.size).toBe(0);
	});

	it("send rejects when the client has not been started", async () => {
		const client = new RpcClient({
			command: process.execPath,
			args: [],
			name: "unstarted",
		});

		await expect(client.send({ type: "get_messages" })).rejects.toThrow(
			"client not started or stdin closed",
		);
	});
});
