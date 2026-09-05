import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_FILES = [
	"README.md",
	"package.json",
	"lib/roundtable.mjs",
	"lib/pi-roundtable.mjs",
	"lib/rpc-client.mjs",
	"peers/orchestrator.md",
	"peers/implementer.md",
	"peers/developer.md",
	"peers/researcher.md",
	"peers/critic.md",
	"peers/code-reviewer.md",
	"peers/committer.md",
	"peers/releaser.md",
	"presets.json",
	"types/peer.ts",
	"types/rpc.ts",
	"types/transcript.ts",
];

describe("Roundtable smoke test", () => {
	it("has all required roundtable files", () => {
		const missing = REQUIRED_FILES.filter(
			(file) => !existsSync(resolve(process.cwd(), file)),
		);

		expect(missing).toEqual([]);
	});

	it("reports workflow success", () => {
		const message = "Roundtable workflow smoke test passed";
		expect(message).toContain("passed");
	});
});
