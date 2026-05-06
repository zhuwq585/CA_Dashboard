import type { SessionInfo } from '../types.js';

type WatcherCallback = (sessions: SessionInfo[]) => void | Promise<void>;

export class SessionFileWatcher {
	start(_callback: WatcherCallback): void {
		throw new Error('Not implemented');
	}
	stop(): void {
		throw new Error('Not implemented');
	}
}
