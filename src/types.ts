export interface SessionInfo {
	pid: number;
	sessionId: string;
	cwd: string;
	startedAt: number;
	name?: string;
	status?: string;
	updatedAt?: number;
}

export enum SessionStatus {
	Executing = 'Executing',
	Waiting = 'Waiting',
	Idle = 'Idle',
	Hanging = 'Hanging',
	Dead = 'Dead',
}

export interface ResolvedSession {
	session: SessionInfo;
	status: SessionStatus;
	displayName: string;
	resolvedAt: number;
}
