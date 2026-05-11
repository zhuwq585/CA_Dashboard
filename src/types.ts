export enum SessionStatus {
	Executing = 'executing',
	Waiting   = 'waiting',
	Idle      = 'idle',
	Hanging   = 'hanging',
	Dead      = 'dead',
}

export interface SessionInfo {
	pid:           number;
	sessionId:     string;
	cwd:           string;
	startedAt:     number;
	name?:         string;
	procStart?:    string;
	version?:      string;
	peerProtocol?: number;
	kind?:         string;
	entrypoint?:   string;
	status?:       string;
	updatedAt?:    number;
}

export interface ResolvedSession {
	sessionInfo:    SessionInfo;
	status:         SessionStatus;
	displayName:    string;
	resolvedAt:     number;
	lastActiveMs?:  number;  // best available "last activity" timestamp: max(updatedAt, JSONL mtime)
}

export type ConversationState =
	| { kind: 'pendingToolApproval' }
	| { kind: 'assistantDone' }
	| { kind: 'userTurn' }
	| { kind: 'unknown' };
