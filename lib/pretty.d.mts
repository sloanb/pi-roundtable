export interface PrettyResult {
	pretty: string;
	wasJSON: boolean;
}

export interface OrchestratorAction {
	action: "route" | "done" | "fallback";
	next_peer?: string;
	reason?: string;
	instruction?: string;
	expected_output?: string;
	summary?: string;
	final_artifacts?: Record<string, unknown>;
	state_update?: {
		completed_tasks?: string[];
		pending_tasks?: string[];
		blocked_tasks?: string[];
		artifacts?: Record<string, unknown>;
	};
}

export interface PeerReport {
	status: "complete" | "needs_input" | "blocked" | "error";
	findings: string;
	artifacts: string[];
	recommended_next_peer: string | null;
}

export declare function formatOrchestratorAction(
	action: OrchestratorAction,
	colorEnabled: boolean,
): string;

export declare function formatPeerReport(
	report: PeerReport,
	peerName: string,
	peerRole: string,
	colorEnabled: boolean,
): string;

export declare function prettyAgentOutput(
	text: string,
	role: string,
	colorEnabled?: boolean,
): PrettyResult;

export declare function prettyPeerReport(
	text: string,
	peerName: string,
	peerRole: string,
	colorEnabled?: boolean,
): PrettyResult;
