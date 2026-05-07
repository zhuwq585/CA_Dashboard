import { describe, it, expect } from 'vitest';
import { SessionStatus, type SessionInfo } from './types.js';

const minimalSession: SessionInfo = {
	pid: 1234,
	sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
	cwd: '/home/user/project',
	startedAt: 1000000000000,
};

const fullSession: SessionInfo = {
	...minimalSession,
	name: 'my-project',
	procStart: 'Mon Jan  1 00:00:00 2026',
	version: '2.1.128',
	peerProtocol: 1,
	kind: 'interactive',
	entrypoint: 'cli',
	status: 'busy',
	updatedAt: 1000000060000,
};

describe('SessionStatus', () => {
	it('T1: Executing has value "executing"', () => {
		expect(SessionStatus.Executing).toBe('executing');
	});

	it('T2: Waiting has value "waiting"', () => {
		expect(SessionStatus.Waiting).toBe('waiting');
	});

	it('T3: Idle has value "idle"', () => {
		expect(SessionStatus.Idle).toBe('idle');
	});

	it('T4: Hanging has value "hanging"', () => {
		expect(SessionStatus.Hanging).toBe('hanging');
	});

	it('T5: Dead has value "dead"', () => {
		expect(SessionStatus.Dead).toBe('dead');
	});
});

// Compile-time check: minimalSession and fullSession must satisfy SessionInfo.
// If the types are wrong this file won't compile.
describe('SessionInfo type fixtures', () => {
	it('minimalSession satisfies SessionInfo', () => {
		expect(minimalSession.pid).toBe(1234);
		expect(minimalSession.sessionId).toBe('aaaaaaaa-0000-0000-0000-000000000000');
	});

	it('fullSession satisfies SessionInfo', () => {
		expect(fullSession.name).toBe('my-project');
		expect(fullSession.updatedAt).toBe(1000000060000);
	});
});
