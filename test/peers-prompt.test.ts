import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Conclusion-authority audit for peer prompts.
 *
 * In orchestrated mode the orchestrator ALONE concludes the workflow:
 * workers always [YIELD] back to it. A worker prompt that teaches "[DONE]"
 * invites the model to conclude runs itself — this suite pins the persona
 * files so that class of regression can't slip back in.
 */

const PEERS_DIR = join(import.meta.dirname ?? ".", "..", "peers");

function workerPeerFiles(): string[] {
	return readdirSync(PEERS_DIR)
		.filter((f) => f.endsWith(".md") && f !== "orchestrator.md")
		.sort();
}

describe("peer prompt audit: conclusion authority", () => {
	it("no worker peer prompt mentions [DONE]", () => {
		const files = workerPeerFiles();
		expect(files.length).toBeGreaterThanOrEqual(7); // the shipped worker peers
		for (const file of files) {
			const content = readFileSync(join(PEERS_DIR, file), "utf-8");
			expect(
				content.includes("[DONE]"),
				`${file} must not teach or mention [DONE] — workers never conclude`,
			).toBe(false);
		}
	});

	it("every worker peer prompt teaches [YIELD]", () => {
		for (const file of workerPeerFiles()) {
			const content = readFileSync(join(PEERS_DIR, file), "utf-8");
			expect(
				content.includes("[YIELD]"),
				`${file} must instruct workers to end with [YIELD]`,
			).toBe(true);
		}
	});

	it("every worker peer prompt defers conclusion to the Orchestrator", () => {
		for (const file of workerPeerFiles()) {
			const content = readFileSync(join(PEERS_DIR, file), "utf-8");
			expect(
				content.toLowerCase().includes("orchestrator"),
				`${file} should reference the Orchestrator as the concluding authority`,
			).toBe(true);
		}
	});

	it("the orchestrator prompt claims exclusive [DONE] authority", () => {
		const content = readFileSync(join(PEERS_DIR, "orchestrator.md"), "utf-8");
		expect(content).toContain("[DONE]");
		expect(content).toContain("Only you");
		expect(content).toContain("[YIELD]");
	});
});
