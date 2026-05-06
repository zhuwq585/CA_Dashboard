import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SessionStatus } from '../types.js';
import type { ResolvedSession } from '../types.js';
import { Dashboard } from './Dashboard.js';

// Yield to the event loop so Ink's effects run and React re-renders flush.
const tick = () => Promise.resolve();
// Wait long enough for Ink's 20ms pending-escape flush timer.
const waitEsc = () => new Promise<void>(r => setTimeout(r, 25));

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

// --- Watch mode: display ---

describe('Watch mode — display', () => {
	it('U1: shows all non-Dead sessions when watchedIds empty', async () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession, idleSession, deadSession],
				onExit: vi.fn(),
			})
		);
		await tick();
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
		await tick();
		stdin.write('s'); await tick(); // enter select, cursor at proj-exec
		stdin.write(' '); await tick(); // toggle proj-exec on
		stdin.write('\r'); await tick(); // confirm
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
		await tick();
		stdin.write('s'); await tick(); // enter select; cursor at deadSession
		stdin.write(' '); await tick(); // toggle deadSession into watchedIds
		stdin.write('\r'); await tick(); // confirm
		const frame = lastFrame()!;
		expect(frame).not.toContain('proj-dead');
	});

	it('U4: status labels rendered', async () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		expect(lastFrame()!).toContain('⚙ Executing');
	});

	it('U5: empty state message shown when sessions empty', async () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [],
				onExit: vi.fn(),
			})
		);
		await tick();
		expect(lastFrame()!).toContain('No sessions selected');
	});

	it('U6: hint bar shown', async () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		const frame = lastFrame()!;
		expect(frame).toContain('[s]');
		expect(frame).toContain('[q]');
	});
});

// --- Watch mode: keyboard ---

describe('Watch mode — keyboard', () => {
	it('U7: q calls onExit', async () => {
		const onExit = vi.fn();
		const { stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit,
			})
		);
		await tick();
		stdin.write('q');
		await tick();
		expect(onExit).toHaveBeenCalledOnce();
	});

	it('U8: s switches to select mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s');
		await tick();
		expect(lastFrame()!).toContain('Select sessions');
	});
});

// --- Select mode: display ---

describe('Select mode — display', () => {
	it('U9: all sessions listed including Dead', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, deadSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		const frame = lastFrame()!;
		expect(frame).toContain('proj-exec');
		expect(frame).toContain('proj-dead');
	});

	it('U10: unchecked sessions show [ ]', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick(); // cursor at 0 → [►] proj-exec; proj-wait shows [ ]
		expect(lastFrame()!).toContain('[ ]');
	});

	it('U11: checked sessions show [✓]', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s');      await tick(); // cursor at 0 (proj-exec)
		stdin.write(' ');      await tick(); // toggle proj-exec on (cursor still at 0 → [►])
		stdin.write('\x1B[B'); await tick(); // move cursor down → proj-exec now shows [✓]
		expect(lastFrame()!).toContain('[✓]');
	});

	it('U12: cursor row shows [►]', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		expect(lastFrame()!).toContain('[►]');
	});

	it('U13: hint bar shown in select mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		const frame = lastFrame()!;
		expect(frame).toContain('↑↓');
		expect(frame).toContain('enter');
		expect(frame).toContain('esc');
	});
});

// --- Select mode: keyboard ---

describe('Select mode — keyboard', () => {
	it('U14: ↓ moves cursor down', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s');      await tick();
		stdin.write('\x1B[B'); await tick(); // down arrow
		const frame = lastFrame()!;
		const lines = frame.split('\n');
		const cursorLine = lines.find(l => l.includes('[►]'))!;
		expect(cursorLine).toContain('proj-wait');
	});

	it('U15: ↑ wraps cursor to bottom', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s');      await tick();
		stdin.write('\x1B[A'); await tick(); // up arrow (cursor at 0 → wraps to last)
		const frame = lastFrame()!;
		const lines = frame.split('\n');
		const cursorLine = lines.find(l => l.includes('[►]'))!;
		expect(cursorLine).toContain('proj-wait');
	});

	it('U16: ↓ wraps cursor to top', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s');      await tick();
		stdin.write('\x1B[B'); await tick(); // down → index 1
		stdin.write('\x1B[B'); await tick(); // down → wraps to index 0
		const frame = lastFrame()!;
		const lines = frame.split('\n');
		const cursorLine = lines.find(l => l.includes('[►]'))!;
		expect(cursorLine).toContain('proj-exec');
	});

	it('U17: space toggles item on', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s');      await tick(); // cursor at 0 (proj-exec)
		stdin.write(' ');      await tick(); // toggle proj-exec on
		stdin.write('\x1B[B'); await tick(); // move cursor to 1 → proj-exec shows [✓]
		expect(lastFrame()!).toContain('[✓]');
	});

	it('U18: space toggles item off', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		stdin.write(' '); await tick(); // toggle proj-exec on (cursor at 0)
		stdin.write(' '); await tick(); // toggle proj-exec off (cursor still at 0 → [►])
		// proj-wait (index 1, not at cursor, not checked) shows [ ]
		expect(lastFrame()!).toContain('[ ]');
	});

	it('U19: enter commits selection, returns to watch mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick(); // enter select, cursor at proj-exec
		stdin.write(' '); await tick(); // toggle proj-exec on
		stdin.write('\r'); await tick(); // confirm → watchedIds = {proj-exec}
		const frame = lastFrame()!;
		expect(frame).toContain('proj-exec');
		expect(frame).not.toContain('proj-wait');
		expect(frame).toContain('[s]'); // back in watch mode
	});

	it('U20: esc discards selection, returns to watch mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick(); // enter select
		stdin.write(' '); await tick(); // toggle proj-exec into pending
		stdin.write('\x1B');            // esc — pending, needs 20ms flush
		await waitEsc();                // wait for Ink's escape flush timer
		await tick();                   // let re-render flush
		const frame = lastFrame()!;
		expect(frame).toContain('[s]');       // back in watch mode
		expect(frame).toContain('proj-exec'); // watchedIds still empty → all non-dead shown
	});

	it('U21: previously committed selection preserved on esc', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();

		// commit proj-wait: enter select, move down, toggle, confirm
		stdin.write('s');      await tick(); // enter select, cursor=0 (proj-exec)
		stdin.write('\x1B[B'); await tick(); // down → cursor=1 (proj-wait)
		stdin.write(' ');      await tick(); // toggle proj-wait on
		stdin.write('\r');     await tick(); // confirm → watchedIds = {proj-wait}

		// enter select again, toggle proj-exec at cursor 0, then esc
		stdin.write('s');      await tick(); // enter select, cursor reset to 0 (proj-exec)
		stdin.write(' ');      await tick(); // toggle proj-exec into pending
		stdin.write('\x1B');                 // esc — pending flush needed
		await waitEsc();
		await tick();

		const frame = lastFrame()!;
		expect(frame).toContain('proj-wait');
		expect(frame).not.toContain('proj-exec');
	});
});
