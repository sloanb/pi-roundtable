export interface Turn {
	peer: string;
	role: string;
	text: string;
	round: number;
	/** Validated structured report (orchestrated mode), if any. */
	structured?: unknown | null;
	/** Turn duration in milliseconds, when timing is tracked. */
	durationMs?: number;
	/** Orchestrator routing context attached to worker turns. */
	orchestrator_action?: unknown | null;
}

export type TranscriptOutcome = "consensus" | "max-rounds-reached";

export interface TranscriptPeerMeta {
	name: string;
	role?: string;
	model?: string;
}

export interface TranscriptMeta {
	date?: string;
	ended?: string;
	duration_seconds?: number;
	topic?: string;
	rounds?: number;
	outcome?: TranscriptOutcome;
	tags?: string[];
	peers?: TranscriptPeerMeta[];
}

/**
 * A peer's final structured report (orchestrated mode), collected for the
 * conclusion block.
 */
export interface PeerFinding {
	peer: string;
	role: string;
	status: string;
	findings: string;
	artifacts: string[];
}

/**
 * Conclusion data captured the moment a [DONE] consensus is reached.
 *
 * Sequential mode fills byPeer/byRole/round/summary; orchestrated mode
 * additionally fills the task lists, artifacts, and per-peer findings so
 * the final report includes the summary and all details.
 */
export interface Conclusion {
	mode: "sequential" | "orchestrated";
	byPeer: string;
	byRole: string;
	round: number;
	summary: string;
	structured?: unknown | null;
	artifacts: string[];
	completedTasks: string[] | null;
	pendingTasks: string[] | null;
	blockedTasks: string[] | null;
	peerFindings: PeerFinding[] | null;
}

export interface RunResult {
	transcript: Turn[];
	consensus: boolean;
	rounds: number;
	conclusion: Conclusion | null;
}
