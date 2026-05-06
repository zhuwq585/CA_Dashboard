import type { SessionInfo, ResolvedSession } from '../types.js';

export class StatusResolver {
	resolve(_sessionInfos: SessionInfo[]): Promise<ResolvedSession[]> {
		throw new Error('Not implemented');
	}
}
