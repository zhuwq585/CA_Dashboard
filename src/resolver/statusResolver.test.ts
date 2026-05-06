import { describe, it, expect, vi, beforeEach } from 'vitest';
import { x, type Output } from 'tinyexec';
import { SessionInfo, SessionStatus } from '../types.js';
import { StatusResolver, resolveDisplayName } from './statusResolver.js';

vi.mock('tinyexec');
const mockX = vi.mocked(x);

const ok = (stdout = ''): Output => ({ stdout, stderr: '', exitCode: 0 });

function mockPs(pid: number, alive: boolean) {
	mockX.mockImplementation(async (cmd, args) => {
		if (cmd === 'ps' && args?.includes(String(pid))) {
			if (!alive) throw Object.assign(new Error('ps failed'), { exitCode: 1 });
			return ok();
		}
		return ok();
	});
}

function mockPsAndPgrep(pid: number, alive: boolean, children: string[]) {
	mockX.mockImplementation(async (cmd, args) => {
		if (cmd === 'ps' && args?.includes(String(pid))) {
			if (!alive) throw Object.assign(new Error('ps failed'), { exitCode: 1 });
			return ok();
		}
		if (cmd === 'pgrep' && args?.includes(String(pid))) {
			if (children.length === 0) {
				throw Object.assign(new Error('pgrep no children'), { exitCode: 1 });
			}
			return ok(children.join('\n'));
		}
		return ok();
	});
}

const baseSession: SessionInfo = {
	pid: 1234,
	sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
	cwd: '/home/user/my-project',
	startedAt: 1_000_000_000_000,
};

const NOW = 1_700_000_000_000;

beforeEach(() => {
	vi.setSystemTime(NOW);
	vi.clearAllMocks();
});

// --- resolveDisplayName tests ---

describe('resolveDisplayName', () => {
	it('D1: uses name when present', () => {
		const session = { ...baseSession, name: 'foo', cwd: '/a/b' };
		expect(resolveDisplayName(session)).toBe('foo');
	});

	it('D2: falls back to basename(cwd) when no name', () => {
		const session = { ...baseSession, cwd: '/home/user/my-project', sessionId: '12345678abcd' };
		expect(resolveDisplayName(session)).toBe('my-project');
	});

	it('D3: falls back to 8-char sessionId when cwd is root', () => {
		const session = { ...baseSession, cwd: '/', sessionId: '12345678abcd' };
		expect(resolveDisplayName(session)).toBe('12345678');
	});

	it('D4: falls back to 8-char sessionId when cwd is empty string', () => {
		const session = { ...baseSession, cwd: '', sessionId: '12345678abcd' };
		expect(resolveDisplayName(session)).toBe('12345678');
	});
});

// --- resolve() decision tree tests ---

describe('StatusResolver.resolve', () => {
	it('R1: Dead — ps fails', async () => {
		mockPs(1234, false);
		const resolver = new StatusResolver();
		const [result] = await resolver.resolve([baseSession]);
		expect(result.status).toBe(SessionStatus.Dead);
	});

	it('R2: Idle — old schema (no status field)', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver();
		const [result] = await resolver.resolve([baseSession]);
		expect(result.status).toBe(SessionStatus.Idle);
	});

	it('R3: Idle — status is not busy', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver();
		const session = { ...baseSession, status: 'idle', updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Idle);
	});

	it('R4: Hanging — updatedAt older than threshold', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver();
		const session = { ...baseSession, status: 'busy', updatedAt: NOW - 121_000 };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Hanging);
	});

	it('R5: Hanging boundary — exactly at threshold', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver();
		const session = { ...baseSession, status: 'busy', updatedAt: NOW - 120_000 };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Hanging);
	});

	it('R6: Executing — has real child processes', async () => {
		mockPsAndPgrep(1234, true, ['node']);
		const resolver = new StatusResolver();
		const session = { ...baseSession, status: 'busy', updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Executing);
	});

	it('R7: Waiting — only helper child (caffeinate)', async () => {
		mockPsAndPgrep(1234, true, ['caffeinate']);
		const resolver = new StatusResolver();
		const session = { ...baseSession, status: 'busy', updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});

	it('R8: Executing — caffeinate plus real child', async () => {
		mockPsAndPgrep(1234, true, ['caffeinate', 'bash']);
		const resolver = new StatusResolver();
		const session = { ...baseSession, status: 'busy', updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Executing);
	});

	it('R9: Waiting — no child processes at all', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver();
		const session = { ...baseSession, status: 'busy', updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});

	it('R10: Dead session has correct displayName', async () => {
		mockPs(1234, false);
		const resolver = new StatusResolver();
		const session = { ...baseSession, name: 'proj' };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Dead);
		expect(result.displayName).toBe('proj');
	});

	it('R11: resolvedAt is close to Date.now()', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver();
		const [result] = await resolver.resolve([baseSession]);
		expect(Math.abs(result.resolvedAt - Date.now())).toBeLessThan(100);
	});

	it('R12: multiple sessions resolved concurrently', async () => {
		const sessions: SessionInfo[] = [
			{ ...baseSession, pid: 1001, sessionId: 'sess-1', status: 'busy', updatedAt: NOW },
			{ ...baseSession, pid: 1002, sessionId: 'sess-2', status: 'busy', updatedAt: NOW - 121_000 },
			{ ...baseSession, pid: 1003, sessionId: 'sess-3' },
		];

		mockX.mockImplementation(async (cmd, args) => {
			if (cmd === 'ps') return ok();
			if (cmd === 'pgrep') {
				if (args?.includes('1001')) return ok('node');
				throw Object.assign(new Error('no children'), { exitCode: 1 });
			}
			return ok();
		});

		const resolver = new StatusResolver();
		const results = await resolver.resolve(sessions);
		expect(results).toHaveLength(3);
		expect(results[0].status).toBe(SessionStatus.Executing);
		expect(results[1].status).toBe(SessionStatus.Hanging);
		expect(results[2].status).toBe(SessionStatus.Idle);
	});

	it('R13: custom hangingThresholdMs respected', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ hangingThresholdMs: 30_000 });
		const session = { ...baseSession, status: 'busy', updatedAt: NOW - 31_000 };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Hanging);
	});

	it('R14: custom helperProcesses respected', async () => {
		mockPsAndPgrep(1234, true, ['node']);
		const resolver = new StatusResolver({ helperProcesses: ['node'] });
		const session = { ...baseSession, status: 'busy', updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});
});
