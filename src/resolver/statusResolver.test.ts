import { describe, it, expect, vi, beforeEach } from 'vitest';
import { x, type Result } from 'tinyexec';
import { SessionInfo, SessionStatus, ConversationState } from '../types.js';
import { StatusResolver, resolveDisplayName } from './statusResolver.js';
import { ConversationLogReader, type ConversationStateResult } from '../jsonl/conversationLogReader.js';

vi.mock('tinyexec');
const mockX = vi.mocked(x);

const ok = (stdout = ''): Result => ({ stdout, stderr: '', exitCode: 0 } as unknown as Result);

function mockPs(pid: number, alive: boolean) {
	mockX.mockImplementation((async (cmd: string, args?: string[]) => {
		if (cmd === 'ps' && args?.includes(String(pid))) {
			if (!alive) throw Object.assign(new Error('ps failed'), { exitCode: 1 });
			return ok();
		}
		return ok();
	}) as unknown as typeof x);
}

function mockPsAndPgrep(pid: number, alive: boolean, children: string[]) {
	mockX.mockImplementation((async (cmd: string, args?: string[]) => {
		if (cmd === 'ps' && args?.includes(String(pid))) {
			if (!alive) throw Object.assign(new Error('ps failed'), { exitCode: 1 });
			return ok();
		}
		if (cmd === 'pgrep' && args?.includes(String(pid))) {
			if (children.length === 0) {
				throw Object.assign(new Error('pgrep no children'), { exitCode: 1 });
			}
			return ok(children.map((name, i) => `${90000 + i} ${name}`).join('\n'));
		}
		return ok();
	}) as unknown as typeof x);
}

// Returns a stub ConversationLogReader that always reports the given state.
function stubReader(state: ConversationState, mtimeMs?: number): ConversationLogReader {
	const result: ConversationStateResult = mtimeMs === undefined ? { state } : { state, mtimeMs };
	return { readState: vi.fn().mockResolvedValue(result) } as unknown as ConversationLogReader;
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
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }) });
		const [result] = await resolver.resolve([baseSession]);
		expect(result.status).toBe(SessionStatus.Dead);
	});

	it('R10: Dead session has correct displayName', async () => {
		mockPs(1234, false);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }) });
		const session = { ...baseSession, name: 'proj' };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Dead);
		expect(result.displayName).toBe('proj');
	});

	it('R11: resolvedAt is close to Date.now()', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'unknown' }) });
		const [result] = await resolver.resolve([baseSession]);
		expect(Math.abs(result.resolvedAt - Date.now())).toBeLessThan(100);
	});

	it('R12: multiple sessions resolved concurrently', async () => {
		const sessions: SessionInfo[] = [
			{ ...baseSession, pid: 1001, sessionId: 'sess-1', updatedAt: NOW },
			{ ...baseSession, pid: 1002, sessionId: 'sess-2', updatedAt: NOW - 8_000_000 },
			{ ...baseSession, pid: 1003, sessionId: 'sess-3' },
		];

		mockX.mockImplementation((async (cmd: string, args?: string[]) => {
			if (cmd === 'ps') return ok();
			if (cmd === 'pgrep') {
				if (args?.includes('1001')) return ok('90000 node');
				throw Object.assign(new Error('no children'), { exitCode: 1 });
			}
			return ok();
		}) as unknown as typeof x);

		const reader = {
			readState: vi.fn().mockImplementation(async (_cwd: string, sessionId: string) => {
				if (sessionId === 'sess-1') return { state: { kind: 'pendingToolApproval' as const }, mtimeMs: NOW };
				if (sessionId === 'sess-2') return { state: { kind: 'assistantDone' as const }, mtimeMs: NOW - 8_000_000 };
				return { state: { kind: 'unknown' as const } };
			}),
		} as unknown as ConversationLogReader;

		const resolver = new StatusResolver({ logReader: reader });
		const results = await resolver.resolve(sessions);
		expect(results).toHaveLength(3);
		expect(results[0].status).toBe(SessionStatus.Executing);
		expect(results[1].status).toBe(SessionStatus.Hanging);
		expect(results[2].status).toBe(SessionStatus.Idle);
	});

	it('R13: custom hangingThresholdMs respected', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({
			hangingThresholdMs: 30_000,
			logReader: stubReader({ kind: 'pendingToolApproval' }, NOW - 31_000),
		});
		const session = { ...baseSession, updatedAt: NOW - 31_000 };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Hanging);
	});

	it('R14: custom helperProcesses respected', async () => {
		mockPsAndPgrep(1234, true, ['node']);
		const resolver = new StatusResolver({
			helperProcesses: ['node'],
			logReader: stubReader({ kind: 'pendingToolApproval' }, NOW),
		});
		const session = { ...baseSession, updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});

	// --- JSONL-based decision tree tests ---

	it('R-J1: Waiting — pendingToolApproval, no real children', async () => {
		mockPsAndPgrep(1234, true, ['caffeinate']);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW) });
		const session = { ...baseSession, updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});

	it('R-J2: Executing — pendingToolApproval, real children present', async () => {
		mockPsAndPgrep(1234, true, ['bash']);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW) });
		const session = { ...baseSession, updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Executing);
	});

	it('R-J3: Idle — assistantDone (assistant finished, no pending action)', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'assistantDone' }, NOW) });
		const session = { ...baseSession, updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Idle);
	});

	it('R-J4: Executing — userTurn (model generating)', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'userTurn' }, NOW) });
		const session = { ...baseSession, updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Executing);
	});

	it('R-J5: Hanging — stale JSONL mtime', async () => {
		mockPsAndPgrep(1234, true, ['bash']);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW - 8_000_000) });
		const session = { ...baseSession };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Hanging);
	});

	it('R-J6: Idle — unknown state', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'unknown' }) });
		const [result] = await resolver.resolve([baseSession]);
		expect(result.status).toBe(SessionStatus.Idle);
	});

	it('R-J7: Dead PID overrides JSONL', async () => {
		mockPs(1234, false);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW) });
		const [result] = await resolver.resolve([baseSession]);
		expect(result.status).toBe(SessionStatus.Dead);
	});

	it('R-J8: Hanging — both session.updatedAt and JSONL mtime stale', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'assistantDone' }, NOW - 8_000_000) });
		const session = { ...baseSession, updatedAt: NOW - 8_000_000 };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Hanging);
	});

	it('R-J9: Executing — long-running tool (fresh updatedAt, stale JSONL mtime)', async () => {
		// JSONL only updates when the tool finishes; session.updatedAt keeps ticking.
		// Hanging must NOT fire while a real child is still running.
		mockPsAndPgrep(1234, true, ['bash']);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW - 8_000_000) });
		const session = { ...baseSession, updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Executing);
	});

	it('R-J11b: systemd-inhibit is filtered (Linux parity with caffeinate)', async () => {
		// On Linux, Claude Code uses systemd-inhibit instead of caffeinate to keep
		// the system awake. It must be treated as a helper, not a real child.
		mockPsAndPgrep(1234, true, ['systemd-inhibit']);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW) });
		const session = { ...baseSession, updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});

	it('R-J12: lastActiveMs falls back to JSONL mtime when updatedAt is missing', async () => {
		// Older Claude Code (and likely Linux builds) don't write updatedAt. The UI's
		// "Last Active" column would otherwise show "unknown". JSONL mtime is the fallback.
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'assistantDone' }, NOW - 30_000) });
		const session = { ...baseSession };  // no updatedAt
		const [result] = await resolver.resolve([session]);
		expect(result.lastActiveMs).toBe(NOW - 30_000);
	});

	it('R-J13: lastActiveMs picks the more recent of updatedAt and mtime', async () => {
		mockPsAndPgrep(1234, true, []);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'assistantDone' }, NOW - 5_000) });
		const session = { ...baseSession, updatedAt: NOW - 20_000 };
		const [result] = await resolver.resolve([session]);
		expect(result.lastActiveMs).toBe(NOW - 5_000);
	});

	it('R-J11: Waiting — session.status="waiting" overrides process tree', async () => {
		// Approval prompt for a Bash command: zsh is already spawned (will host the
		// command once approved). Without the status check, the resolver would see
		// 'zsh' as a real child and classify Executing — wrong.
		mockPsAndPgrep(1234, true, ['caffeinate', 'zsh']);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW) });
		const session = { ...baseSession, status: 'waiting', updatedAt: NOW };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});

	it('R-J10: Waiting — approval-pending with stale updatedAt (JSONL still fresh)', async () => {
		// Approval prompt: session.updatedAt stops ticking but the JSONL was just updated
		// by the assistant requesting the tool. Don't misclassify as Hanging.
		mockPsAndPgrep(1234, true, ['caffeinate']);
		const resolver = new StatusResolver({ logReader: stubReader({ kind: 'pendingToolApproval' }, NOW) });
		const session = { ...baseSession, updatedAt: NOW - 8_000_000 };
		const [result] = await resolver.resolve([session]);
		expect(result.status).toBe(SessionStatus.Waiting);
	});
});
