import type { RpcPeerOptions, RpcCommand, RpcEvent } from "../types/rpc.js";

export declare class RpcClient {
	constructor(opts: RpcPeerOptions);

	start(): Promise<void>;
	send<T = unknown>(cmd: RpcCommand): Promise<T> | undefined;
	onEvent(fn: (event: RpcEvent) => void): () => void;
	kill(): void;

	readonly exitInfo: {
		code: number | null;
		signal: string | null;
		stderr: string;
	} | null;
	readonly pid: number | undefined;
}

export declare function nextSettled(client: RpcClient): Promise<void>;
