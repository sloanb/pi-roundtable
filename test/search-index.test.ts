import { describe, it, expect, afterEach, vi } from "vitest";
import type { MockInstance } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	searchIndexPath,
	writeSearchIndex,
	readSearchIndex,
	resolveResultRef,
	agoLabel,
} from "../lib/search-index.mjs";
import type {
	ResolvedResultRef,
	ResultRefError,
} from "../lib/search-index.mjs";
import { runSearch, runShow } from "../lib/pi-roundtable.mjs";

/** Assert a failed resolveResultRef and return its message. */
function expectFailed(r: ResolvedResultRef | ResultRefError): string {
	if (!r.ok) return r.error;
	throw new Error("expected resolveResultRef to fail, but it succeeded");
}

/** Minimal valid transcript file content. */
function transcriptMd(topic: string, body: string) {
	return `---\ndate: 2026-01-01T00:00:00.000Z\ntopic: ${JSON.stringify(topic)}\nrounds: 1\noutcome: consensus\n---\n\n# Roundtable: ${topic}\n\n${body}\n`;
}

function makeTempDirs() {
	const root = mkdtempSync(join(tmpdir(), "rt-search-"));
	const transcriptsDir = join(root, "tables");
	const installDir = join(root, "install");
	mkdirSync(transcriptsDir);
	mkdirSync(installDir);
	return { root, transcriptsDir, installDir };
}

const dirsStack: string[] = [];
function tempDirs() {
	const d = makeTempDirs();
	dirsStack.push(d.root);
	return d;
}
afterEach(() => {
	while (dirsStack.length > 0) {
		const root = dirsStack.pop();
		if (root === undefined) break;
		rmSync(root, { recursive: true, force: true });
	}
	viRestoreConsole();
});

let logSpy: MockInstance | undefined;
let errorSpy: MockInstance | undefined;
function captureConsole() {
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
}
function viRestoreConsole() {
	logSpy?.mockRestore();
	errorSpy?.mockRestore();
	logSpy = undefined;
	errorSpy = undefined;
}
function logged() {
	return logSpy?.mock.calls.flat().join("\n") ?? "";
}

describe("search-index: path + round-trip", () => {
	it("searchIndexPath is a dotfile under the install dir", () => {
		expect(searchIndexPath("/opt/rt")).toBe("/opt/rt/.search-results.json");
	});

	it("writeSearchIndex → readSearchIndex round-trips ordered results", async () => {
		const { installDir } = tempDirs();
		await writeSearchIndex({
			installDir,
			dir: "/tables",
			term: "cooling",
			results: [
				{ path: "/tables/a.md", topic: "topic a" },
				{ path: "/tables/b.md", topic: "topic b" },
			],
		});
		const index = await readSearchIndex({ installDir });
		expect(index!.term).toBe("cooling");
		expect(index!.dir).toBe("/tables");
		expect(index!.timestamp).toBeGreaterThan(0);
		expect(index!.results).toEqual([
			{ path: "/tables/a.md", topic: "topic a" },
			{ path: "/tables/b.md", topic: "topic b" },
		]);
	});

	it("readSearchIndex returns null for a missing file", async () => {
		const { installDir } = tempDirs();
		expect(await readSearchIndex({ installDir })).toBeNull();
	});

	it("readSearchIndex returns null for corrupt JSON", async () => {
		const { installDir } = tempDirs();
		writeFileSync(searchIndexPath(installDir), "{ not json");
		expect(await readSearchIndex({ installDir })).toBeNull();
	});

	it("readSearchIndex tolerates malformed payloads", async () => {
		const { installDir } = tempDirs();
		writeFileSync(
			searchIndexPath(installDir),
			JSON.stringify({ results: "nope" }),
		);
		expect(await readSearchIndex({ installDir })).toBeNull();
		writeFileSync(
			searchIndexPath(installDir),
			JSON.stringify({ results: [{ topic: "no path" }, { path: "/ok.md" }] }),
		);
		const index = await readSearchIndex({ installDir });
		expect(index!.results).toEqual([{ path: "/ok.md", topic: "" }]);
	});
});

describe("search-index: agoLabel", () => {
	const now = 1_000_000_000;
	it("labels sub-minute as just now", () => {
		expect(agoLabel(now - 30_000, now)).toBe("just now");
		expect(agoLabel(now, now)).toBe("just now");
	});
	it("labels minutes, hours, and days", () => {
		expect(agoLabel(now - 7 * 60_000, now)).toBe("7m ago");
		expect(agoLabel(now - 3 * 3_600_000, now)).toBe("3h ago");
		expect(agoLabel(now - 2 * 86_400_000, now)).toBe("2d ago");
	});
});

describe("search-index: resolveResultRef", () => {
	it("rejects malformed references", async () => {
		const { installDir } = tempDirs();
		for (const ref of ["2", "#", "@", "#x", "@x", "#2x", "@2x", "##2", ""]) {
			const r = await resolveResultRef({ ref, installDir });
			expect(r.ok).toBe(false);
			expect(expectFailed(r)).toContain("Invalid result reference");
		}
	});

	it("reports no snapshot on disk", async () => {
		const { installDir } = tempDirs();
		const r = await resolveResultRef({ ref: "#1", installDir });
		expect(r.ok).toBe(false);
		expect(expectFailed(r)).toContain("No search results in memory");
	});

	it("reports empty-result searches", async () => {
		const { installDir } = tempDirs();
		await writeSearchIndex({ installDir, dir: "/t", term: "zzz", results: [] });
		const r = await resolveResultRef({ ref: "#1", installDir });
		expect(r.ok).toBe(false);
		expect(expectFailed(r)).toContain("found 0 results");
	});

	it("rejects out-of-range numbers with the count", async () => {
		const { installDir } = tempDirs();
		await writeSearchIndex({
			installDir,
			dir: "/t",
			term: "x",
			results: [{ path: "/t/a.md", topic: "a" }],
		});
		for (const ref of ["#0", "#2", "#99"]) {
			const r = await resolveResultRef({ ref, installDir });
			expect(r.ok).toBe(false);
			expect(expectFailed(r)).toContain("out of range");
			expect(expectFailed(r)).toContain("1 result");
		}
	});

	it("rejects entries whose file no longer exists", async () => {
		const { installDir } = tempDirs();
		await writeSearchIndex({
			installDir,
			dir: "/t",
			term: "x",
			results: [{ path: "/t/gone.md", topic: "vanished" }],
		});
		const r = await resolveResultRef({ ref: "#1", installDir });
		expect(r.ok).toBe(false);
		expect(expectFailed(r)).toContain("/t/gone.md");
		expect(expectFailed(r)).toContain("no longer exists");
	});

	it("resolves a valid reference to the ordered entry", async () => {
		const { installDir, transcriptsDir } = tempDirs();
		const a = join(transcriptsDir, "a.md");
		const b = join(transcriptsDir, "b.md");
		writeFileSync(a, transcriptMd("topic a", "body"));
		writeFileSync(b, transcriptMd("topic b", "body"));
		await writeSearchIndex({
			installDir,
			dir: transcriptsDir,
			term: "topic",
			results: [
				{ path: a, topic: "topic a" },
				{ path: b, topic: "topic b" },
			],
		});
		const r = await resolveResultRef({ ref: "#2", installDir });
		expect(r.ok).toBe(true);
		if (!r.ok) throw new Error("expected success");
		expect(r.number).toBe(2);
		expect(r.entry.path).toBe(b);
		expect(r.entry.topic).toBe("topic b");

		// "@N" is the shell-safe form (unquoted "#2" is eaten by shells)
		const at = await resolveResultRef({ ref: "@1", installDir });
		expect(at.ok).toBe(true);
		if (!at.ok) throw new Error("expected success");
		expect(at.number).toBe(1);
		expect(at.entry.path).toBe(a);
	});
});

describe("runSearch: numbered results + snapshot", () => {
	it("numbers results in display order and writes the snapshot", async () => {
		const { installDir, transcriptsDir } = tempDirs();
		writeFileSync(
			join(transcriptsDir, "one.md"),
			transcriptMd("cooling one", "the cooling body"),
		);
		writeFileSync(
			join(transcriptsDir, "two.md"),
			transcriptMd("cooling two", "another cooling body"),
		);
		writeFileSync(
			join(transcriptsDir, "irrelevant.md"),
			transcriptMd("unrelated", "nothing here"),
		);

		captureConsole();
		await runSearch({
			dir: transcriptsDir,
			term: "cooling",
			inField: undefined,
			tagsFilter: [],
			showAll: false,
			installDir,
		});

		const out = logged();
		expect(out).toContain("[1] one.md");
		expect(out).toContain("[2] two.md");
		expect(out).toContain("--show @N");
		expect(out).not.toContain("irrelevant");

		const index = await readSearchIndex({ installDir });
		expect(index!.term).toBe("cooling");
		expect(index!.results.map((r) => r.path)).toEqual([
			join(transcriptsDir, "one.md"),
			join(transcriptsDir, "two.md"),
		]);
	});

	it("writes an empty snapshot for no-match searches", async () => {
		const { installDir, transcriptsDir } = tempDirs();
		writeFileSync(
			join(transcriptsDir, "one.md"),
			transcriptMd("topic one", "body"),
		);
		captureConsole();
		await runSearch({
			dir: transcriptsDir,
			term: "zzz-no-match",
			inField: undefined,
			tagsFilter: [],
			showAll: false,
			installDir,
		});
		const index = await readSearchIndex({ installDir });
		expect(index!.results).toEqual([]);
	});
});

describe("runShow: #N result references", () => {
	it("opens the referenced transcript with a confirmation line", async () => {
		const { installDir, transcriptsDir } = tempDirs();
		const a = join(transcriptsDir, "a.md");
		const b = join(transcriptsDir, "b.md");
		writeFileSync(a, transcriptMd("alpha cooling topic", "body a"));
		writeFileSync(b, transcriptMd("beta cooling topic", "body b"));
		await writeSearchIndex({
			installDir,
			dir: transcriptsDir,
			term: "cooling",
			results: [
				{ path: a, topic: "alpha cooling topic" },
				{ path: b, topic: "beta cooling topic" },
			],
		});

		captureConsole();
		await runShow({
			path: "@2",
			latest: false,
			transcriptsDir: undefined,
			installDir,
		});

		const out = logged();
		expect(out).toContain('Opening result 2 of 2 from search "cooling"');
		expect(out).toContain("beta cooling topic");
		expect(out).toContain("━━━ TRANSCRIPT ━━━");

		// quoted "#2" form still routes
		logSpy?.mockClear();
		await runShow({
			path: "#1",
			latest: false,
			transcriptsDir: undefined,
			installDir,
		});
		expect(logged()).toContain("Opening result 1 of 2");
	});

	it("still opens plain paths unchanged", async () => {
		const { installDir, transcriptsDir } = tempDirs();
		const a = join(transcriptsDir, "a.md");
		writeFileSync(a, transcriptMd("alpha topic", "body a"));

		captureConsole();
		await runShow({
			path: a,
			latest: false,
			transcriptsDir: undefined,
			installDir,
		});

		expect(logged()).toContain("━━━ TRANSCRIPT ━━━");
		expect(logged()).not.toContain("Opening result");
	});
});
