import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SessionStatus } from '../types.js';
import type { ResolvedSession } from '../types.js';
import { Dashboard } from './Dashboard.js';

// --- Fixtures ---

const makeSession = (overrides: Partial<ResolvedSession> = {}): ResolvedSession => ({
	sessionInfo: {
		pid: 1000,
		sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
		cwd: '/home/user/project-a',
		startedAt: 1_000_000_000_000,
		updatedAt: Date.now() - 5_000,
		kind: 'interactive',
		entrypoint: 'cli',
	},
	status: SessionStatus.Waiting,
	displayName: 'project-a',
	resolvedAt: Date.now(),
	...overrides,
});

const executingSession = makeSession({ status: SessionStatus.Executing, displayName: 'proj-exec', sessionInfo: { pid: 1001, sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', cwd: '/home/user/proj-exec', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' } });
const waitingSession   = makeSession({ status: SessionStatus.Waiting,   displayName: 'proj-wait', sessionInfo: { pid: 1002, sessionId: 'aaaaaaaa-0000-0000-0000-000000000002', cwd: '/home/user/proj-wait', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' } });
const idleSession      = makeSession({ status: SessionStatus.Idle,      displayName: 'proj-idle', sessionInfo: { pid: 1003, sessionId: 'aaaaaaaa-0000-0000-0000-000000000003', cwd: '/home/user/proj-idle', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' } });
const deadSession      = makeSession({ status: SessionStatus.Dead,      displayName: 'proj-dead', sessionInfo: { pid: 1004, sessionId: 'aaaaaaaa-0000-0000-0000-000000000004', cwd: '/home/user/proj-dead', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' } });
const hangingSession   = makeSession({ status: SessionStatus.Hanging,   displayName: 'proj-hang', sessionInfo: { pid: 1005, sessionId: 'aaaaaaaa-0000-0000-0000-000000000005', cwd: '/home/user/proj-hang', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' } });

// --- Watch mode: display ---

describe('Watch mode — display', () => {
	it('U1: shows all non-Dead sessions when watchedIds empty', () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession, idleSession, deadSession],
				onExit: vi.fn(),
			})
		);
		const frame = lastFrame()!;
		expect(frame).toContain('proj-exec');
		expect(frame).toContain('proj-wait');
		expect(frame).toContain('proj-idle');
		expect(frame).not.toContain('proj-dead');
	});

	it('U2: shows only selected sessions when watchedIds non-empty', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		// enter select, toggle first item (proj-exec), confirm
		stdin.write('s');
		stdin.write(' ');
		stdin.write('\r');
		const frame = lastFrame()!;
		expect(frame).toContain('proj-exec');
		expect(frame).not.toContain('proj-wait');
	});

	it('U3: Dead session excluded even if in watchedIds', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [deadSession, executingSession],
				onExit: vi.fn(),
			})
		);
		// enter select; cursor starts at deadSession; toggle it; confirm
		stdin.write('s');
		stdin.write(' ');
		stdin.write('\r');
		const frame = lastFrame()!;
		expect(frame).not.toContain('proj-dead');
	});

	it('U4: status labels rendered', () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		expect(lastFrame()!).toContain('⚙ Executing');
	});

	it('U5: empty state message shown when sessions empty', () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [],
				onExit: vi.fn(),
			})
		);
		expect(lastFrame()!).toContain('No sessions selected');
	});

	it('U6: hint bar shown', () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		const frame = lastFrame()!;
		expect(frame).toContain('[s]');
		expect(frame).toContain('[q]');
	});
});

// --- Watch mode: keyboard ---

describe('Watch mode — keyboard', () => {
	it('U7: q calls onExit', () => {
		const onExit = vi.fn();
		const { stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit,
			})
		);
		stdin.write('q');
		expect(onExit).toHaveBeenCalledOnce();
	});

	it('U8: s switches to select mode', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		expect(lastFrame()!).toContain('Select sessions');
	});
});

// --- Select mode: display ---

describe('Select mode — display', () => {
	it('U9: all sessions listed including Dead', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, deadSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		const frame = lastFrame()!;
		expect(frame).toContain('proj-exec');
		expect(frame).toContain('proj-dead');
	});

	it('U10: unchecked sessions show [ ]', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		expect(lastFrame()!).toContain('[ ]');
	});

	it('U11: checked sessions show [✓]', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write(' ');
		expect(lastFrame()!).toContain('[✓]');
	});

	it('U12: cursor row shows [►]', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		expect(lastFrame()!).toContain('[►]');
	});

	it('U13: hint bar shown in select mode', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		const frame = lastFrame()!;
		expect(frame).toContain('↑↓');
		expect(frame).toContain('enter');
		expect(frame).toContain('esc');
	});
});

// --- Select mode: keyboard ---

describe('Select mode — keyboard', () => {
	it('U14: ↓ moves cursor down', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write('[B'); // down arrow
		const frame = lastFrame()!;
		const lines = frame.split('\n');
		const cursorLine = lines.find(l => l.includes('[►]'))!;
		expect(cursorLine).toContain('proj-wait');
	});

	it('U15: ↑ wraps cursor to bottom', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write('[A'); // up arrow
		const frame = lastFrame()!;
		const lines = frame.split('\n');
		const cursorLine = lines.find(l => l.includes('[►]'))!;
		expect(cursorLine).toContain('proj-wait');
	});

	it('U16: ↓ wraps cursor to top', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write('[B'); // move to second
		stdin.write('[B'); // wrap to first
		const frame = lastFrame()!;
		const lines = frame.split('\n');
		const cursorLine = lines.find(l => l.includes('[►]'))!;
		expect(cursorLine).toContain('proj-exec');
	});

	it('U17: space toggles item on', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write(' ');
		expect(lastFrame()!).toContain('[✓]');
	});

	it('U18: space toggles item off', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write(' '); // toggle on
		stdin.write(' '); // toggle off
		expect(lastFrame()!).toContain('[ ]');
	});

	it('U19: enter commits selection, returns to watch mode', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write(' '); // select proj-exec (cursor at 0)
		stdin.write('\r'); // confirm
		const frame = lastFrame()!;
		expect(frame).toContain('proj-exec');
		expect(frame).not.toContain('proj-wait');
		expect(frame).toContain('[s]'); // back in watch mode
	});

	it('U20: esc discards selection, returns to watch mode', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		stdin.write('s');
		stdin.write(' '); // select proj-exec
		stdin.write(''); // esc
		const frame = lastFrame()!;
		// back in watch mode with no selection — all non-dead sessions visible
		expect(frame).toContain('[s]');
		// proj-exec would be visible (watchedIds still empty → show all non-dead)
		expect(frame).toContain('proj-exec');
	});

	it('U21: previously committed selection preserved on esc', () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		// commit proj-wait (move cursor down, toggle, confirm)
		stdin.write('s');
		stdin.write('[B'); // cursor → proj-wait
		stdin.write(' ');        // toggle proj-wait on
		stdin.write('\r');       // confirm → watchedIds = {proj-wait}

		// enter select again, select proj-exec, then esc
		stdin.write('s');
		stdin.write(' ');        // toggle proj-exec on
		stdin.write('');   // esc → discard, revert to {proj-wait}

		const frame = lastFrame()!;
		expect(frame).toContain('proj-wait');
		expect(frame).not.toContain('proj-exec');
	});
});
