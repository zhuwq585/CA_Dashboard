export enum SessionStatus {
	Executing = 'Executing',
	Waiting   = 'Waiting',
	Idle      = 'Idle',
	Hanging   = 'Hanging',
	Dead      = 'Dead',
}

export interface SessionInfo {
	pid:        number;
	sessionId:  string;
	cwd:        string;
	startedAt:  number;
	updatedAt?: number;
	name?:      string;
	status?:    string;
	version?:   string;
	kind:       string;
	entrypoint: string;
}

export interface ResolvedSession {
	sessionInfo: SessionInfo;
	status:      SessionStatus;
	displayName: string;
	resolvedAt:  number;
}
