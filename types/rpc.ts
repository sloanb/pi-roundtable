/**
 * Generic outbound command sent to a pi RPC peer.
 * The pi protocol is JSON-RPC-like but uses `type` instead of `method`.
 */
export interface RpcCommand {
	type: string;
	id?: string | number | null;
	[key: string]: unknown;
}

export interface PromptCommand extends RpcCommand {
	type: "prompt";
	message: string;
}

export interface GetMessagesCommand extends RpcCommand {
	type: "get_messages";
}

export interface RpcEventBase {
	type: string;
	[key: string]: unknown;
}

export interface TextDeltaEvent extends RpcEventBase {
	type: "message_update";
	assistantMessageEvent: {
		type: "text_delta";
		delta: string;
	};
}

export interface AgentSettledEvent extends RpcEventBase {
	type: "agent_settled";
}

export interface RpcResponse extends RpcEventBase {
	type: "response";
	id: string | number;
	success?: boolean;
	error?: string;
	command?: string;
	data?: unknown;
	messages?: unknown[];
}

export interface ParseErrorEvent extends RpcEventBase {
	type: "_parse_error";
	error?: string;
	line?: string;
}

export type RpcEvent =
	| RpcResponse
	| TextDeltaEvent
	| AgentSettledEvent
	| ParseErrorEvent;

export interface RpcPeerOptions {
	command: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	name?: string;
}

export interface TextContentPart {
	type: "text";
	text: string;
}

export interface AssistantMessage {
	role: "assistant";
	content?: TextContentPart[];
}

export interface GetMessagesData {
	messages?: AssistantMessage[];
}
