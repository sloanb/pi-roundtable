export interface Turn {
	peer: string;
	role: string;
	text: string;
	round: number;
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

export interface RunResult {
	transcript: Turn[];
	consensus: boolean;
	rounds: number;
}
