/**
 * pretty.mjs — Human-readable formatting for agent JSON output.
 * Keeps raw JSON for inter-agent communication; only affects console display.
 */

import {
	parseAgentJSON,
	validateOrchestratorAction,
	validatePeerReport,
} from "./roundtable.mjs";

const ROLE_COLOR = {
	researcher: "\x1b[36m", // cyan
	critic: "\x1b[33m", // yellow
	implementer: "\x1b[32m", // green
	developer: "\x1b[34m", // blue
	"code-reviewer": "\x1b[35m", // magenta
	committer: "\x1b[31m", // red
	releaser: "\x1b[33m", // yellow (bright)
	orchestrator: "\x1b[96m", // bright cyan
	user: "\x1b[2m", // dim
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
};

const STATUS_BADGE = {
	complete: "\x1b[32m✅ complete\x1b[0m",
	needs_input: "\x1b[33m⚠️  needs_input\x1b[0m",
	blocked: "\x1b[31m🚫 blocked\x1b[0m",
	error: "\x1b[31m❌ error\x1b[0m",
};

const STATUS_BADGE_PLAIN = {
	complete: "✅ complete",
	needs_input: "⚠️  needs_input",
	blocked: "🚫 blocked",
	error: "❌ error",
};

function colorize(role, text, colorEnabled) {
	if (!colorEnabled) return text;
	const c = ROLE_COLOR[role] ?? "\x1b[37m";
	return `${c}${text}${ROLE_COLOR.reset}`;
}

export function indent(lines, prefix = "   ") {
	return lines.map((l) => `${prefix}${l}`);
}

/**
 * Format orchestrator action for console display.
 */
export function formatOrchestratorAction(action, colorEnabled) {
	const lines = [];

	if (action.action === "route") {
		lines.push(
			colorize("orchestrator", `🎯 Routing to ${action.next_peer}`, colorEnabled),
		);
		lines.push(
			...indent([
				`Reason: ${action.reason}`,
				`Instruction: ${action.instruction}`,
				`Expected: ${action.expected_output}`,
			]),
		);
		if (action.state_update) {
			const updates = [];
			if (action.state_update.completed_tasks?.length)
				updates.push(
					`completed: ${action.state_update.completed_tasks.join(", ")}`,
				);
			if (action.state_update.pending_tasks?.length)
				updates.push(`pending: ${action.state_update.pending_tasks.join(", ")}`);
			if (action.state_update.blocked_tasks?.length)
				updates.push(`blocked: ${action.state_update.blocked_tasks.join(", ")}`);
			if (updates.length) lines.push(...indent([`State: ${updates.join("; ")}`]));
		}
	} else if (action.action === "done") {
		lines.push(colorize("orchestrator", `✅ Consensus Reached`, colorEnabled));
		lines.push(...indent([`Summary: ${action.summary}`]));
		if (action.final_artifacts && Object.keys(action.final_artifacts).length) {
			lines.push(
				...indent([`Artifacts: ${Object.keys(action.final_artifacts).join(", ")}`]),
			);
		}
	} else if (action.action === "fallback") {
		lines.push(
			colorize("orchestrator", `⚠️  Fallback to Sequential`, colorEnabled),
		);
		lines.push(...indent([`Reason: ${action.reason}`]));
	}

	return lines.join("\n");
}

/**
 * Format peer report for console display.
 */
export function formatPeerReport(report, peerName, peerRole, colorEnabled) {
	const lines = [];

	const badge = colorEnabled
		? (STATUS_BADGE[report.status] ?? report.status)
		: (STATUS_BADGE_PLAIN[report.status] ?? report.status);
	lines.push(
		colorize(peerRole, `${badge}  ${peerName} (${peerRole})`, colorEnabled),
	);

	if (report.findings) {
		// Split findings into lines, indent each
		const findingLines = report.findings
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => l.trim());
		if (findingLines.length === 1) {
			lines.push(...indent([`Findings: ${findingLines[0]}`]));
		} else {
			lines.push(...indent(["Findings:"]));
			lines.push(
				...indent(
					findingLines.map((l) => `• ${l}`),
					"      ",
				),
			);
		}
	}

	if (report.artifacts && report.artifacts.length) {
		lines.push(
			...indent([
				`Artifacts: ${report.artifacts.map((a) => (colorEnabled ? `[36m${a}[0m` : a)).join(", ")}`,
			]),
		);
	}

	if (report.recommended_next_peer) {
		lines.push(
			...indent([
				colorize(
					"orchestrator",
					`Next: ${report.recommended_next_peer}`,
					colorEnabled,
				),
			]),
		);
	}

	return lines.join("\n");
}

/**
 * Main entry: format agent output for console.
 * Returns { pretty: string, wasJSON: boolean }
 * - pretty: formatted text for console (may be same as input if not JSON)
 * - wasJSON: true if input was recognized as agent JSON
 */
export function prettyAgentOutput(text, _role, colorEnabled = true) {
	if (!text || typeof text !== "string") {
		return { pretty: text ?? "", wasJSON: false };
	}

	const parsed = parseAgentJSON(text);
	if (!parsed) {
		return { pretty: text, wasJSON: false };
	}

	// Determine JSON type and format accordingly
	if (validateOrchestratorAction(parsed)) {
		return {
			pretty: formatOrchestratorAction(parsed, colorEnabled),
			wasJSON: true,
		};
	}

	if (validatePeerReport(parsed)) {
		// We don't have peer name/role here; caller should use formatPeerReport directly
		return { pretty: text, wasJSON: true };
	}

	return { pretty: text, wasJSON: false };
}

/**
 * Format peer report with known peer identity.
 */
export function prettyPeerReport(
	text,
	peerName,
	peerRole,
	colorEnabled = true,
) {
	if (!text || typeof text !== "string") {
		return { pretty: text ?? "", wasJSON: false };
	}

	const parsed = parseAgentJSON(text);
	if (!parsed || !validatePeerReport(parsed)) {
		return { pretty: text, wasJSON: false };
	}

	return {
		pretty: formatPeerReport(parsed, peerName, peerRole, colorEnabled),
		wasJSON: true,
	};
}
