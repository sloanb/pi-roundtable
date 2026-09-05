/**
 * Static definition of a peer loaded from a markdown file in peers/.
 */
export interface PeerDefinition {
	name: string;
	role: string;
	model?: string;
	tools?: string[];
	systemPrompt?: string;
}

/**
 * Runtime peer configuration used by Roundtable.
 * May carry an optional temp file path for --append-system-prompt.
 */
export interface PeerConfig extends PeerDefinition {
	appendSystemPromptPath?: string;
}

/**
 * Preset composition loaded from presets.json.
 */
export interface Preset {
	description?: string;
	peers: string[];
	tools?: Record<string, string[]>;
}
