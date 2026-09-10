import type { PeerConfig } from "../types/peer.js";
import type {
	TranscriptMeta,
	Turn,
	Conclusion,
	PeerFinding,
} from "../types/transcript.js";

export interface RoundtablePeerConfig extends PeerConfig {
	// PeerConfig carries name/role/model/tools/capabilities/systemPrompt.
	// Add orchestrated-mode extras here as they arise.
}

export interface WorkflowState {
	completed_tasks: string[];
	pending_tasks: string[];
	blocked_tasks: string[];
	artifacts: Record<string, unknown>;
	visit_counts: Record<string, number>;
	last_peer?: string | null;
	consecutive_routes?: number;
}

export interface RoundtableOptions {
	peers: RoundtablePeerConfig[];
	topic: string;
	maxRounds?: number;
	color?: boolean;
	onUpdate?: (line: string) => void;
	signal?: AbortSignal;
	cwd?: string;
	noSession?: boolean;
	mode?: "sequential" | "orchestrated";
	pretty?: boolean;
}

export declare class Roundtable {
	peers: RoundtablePeerConfig[];
	topic: string;
	maxRounds: number;
	color: boolean;
	onUpdate: (line: string) => void;
	signal?: AbortSignal;
	cwd: string;
	noSession: boolean;
	mode: "sequential" | "orchestrated";
	clients: Map<string, unknown>;
	transcript: Turn[];
	round: number;
	conclusion: Conclusion | null;
	/** Worker [DONE]s (orchestrated mode): completion signals for the
	 *  orchestrator — never conclusions. */
	_completionSignals: Array<{ peer: string; round: number }>;
	workflowState: WorkflowState;

	constructor(opts: RoundtableOptions);

	start(): Promise<void>;
	shutdown(): Promise<void>;
	run(): Promise<RunResult>;

	_buildTranscriptText(): string;
	_buildStateSummary(): string;
	_getPeerCapabilities(): string;
	_getPeerList(): Array<{ name: string; role: string; capabilities: string[] }>;
	_applyStateUpdate(update?: Partial<WorkflowState>): void;
	_collectPeerFindings(): PeerFinding[];
	_recordConclusion(opts: {
		byPeer: string;
		byRole: string;
		round: number;
		summary: string;
		structured?: unknown | null;
		finalArtifacts?: Array<string | unknown> | Record<string, unknown> | null;
	}): void;
	_buildConclusionBlock(consensus: boolean): string;
	_finishRun(consensus: boolean): RunResult;
	_fallbackTurn(): Promise<void>;
	_recordCompletionSignal(peerName: string): void;
	/** Speak as a worker. In orchestrated mode, `done` is always false —
	 *  a worker's [DONE] surfaces as `completionSignal` instead. */
	_speakPeer(
		peer: RoundtablePeerConfig,
		orchestratorInstruction: unknown,
	): Promise<{
		text: string;
		yielded: boolean;
		done: boolean;
		completionSignal: boolean;
		structured: unknown | null;
		durationMs: number;
	}>;
	_speakOrchestrator(opts?: { wrapUp?: boolean }): Promise<{
		text: string;
		durationMs: number;
	}>;
	_buildOrchestratorInstruction(
		isFirst: boolean,
		opts?: { wrapUp?: boolean },
	): string;
	_buildPeerInstruction(
		peer: RoundtablePeerConfig,
		orchestratorInstruction: unknown,
		isFirst: boolean,
	): string;
	_startThinking(peer: { name: string; role: string }): void;
	_stopThinking(peer: { name: string; role: string }): void;
	_wireLog(
		client: {
			onEvent(fn: (evt: unknown) => void): () => void;
			kill(): void;
		},
		peer: RoundtablePeerConfig,
	): void;
}

export interface OrchestratorAction {
	action: "route" | "done" | "fallback";
	next_peer?: string;
	instruction?: string;
	reason?: string;
	expected_output?: string;
	state_update?: Partial<WorkflowState>;
	summary?: string;
	final_artifacts?: Record<string, unknown>;
}

export interface PeerReport {
	status: "complete" | "needs_input" | "blocked" | "error";
	findings: string;
	artifacts: string[];
	recommended_next_peer: string | null;
}

export declare function parseAgentJSON(text: string): unknown;
export declare function validateOrchestratorAction(
	obj: unknown,
): obj is OrchestratorAction;
export declare function validatePeerReport(obj: unknown): obj is PeerReport;
