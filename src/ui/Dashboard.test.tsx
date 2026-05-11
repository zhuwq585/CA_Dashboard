import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
		// Pre-select pre-checks both; remove wait to keep only exec
		stdin.write('s');      await tick(); // enter select; pendingIds = {exec, wait}
		stdin.write('\x1B[B'); await tick(); // down → cursor=1 (wait)
		stdin.write(' ');      await tick(); // toggle wait off → pendingIds = {exec}
		stdin.write('\r');     await tick(); // confirm → watchedIds = {exec}
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
		// Pre-select pre-checks both; toggle exec off then move cursor away so exec shows [ ]
		stdin.write('s');      await tick(); // enter select; pendingIds = {exec, wait}
		stdin.write(' ');      await tick(); // toggle exec off → pendingIds = {wait}
		stdin.write('\x1B[B'); await tick(); // down → cursor=1; exec (row 0) shows [ ]
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
		// Pre-select pre-checks both; move cursor down to see exec checked as [✓]
		stdin.write('s');      await tick(); // cursor at 0 (proj-exec, pre-checked)
		stdin.write('\x1B[B'); await tick(); // move cursor down → proj-exec (row 0) shows [✓]
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
		// Pre-select pre-checks both; toggle exec off then back on to demonstrate toggle-on
		stdin.write('s');      await tick(); // cursor at 0 (proj-exec, pre-checked)
		stdin.write(' ');      await tick(); // toggle exec off → not checked
		stdin.write(' ');      await tick(); // toggle exec on → checked again
		stdin.write('\x1B[B'); await tick(); // move cursor to 1 → proj-exec (row 0) shows [✓]
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
		// Pre-select pre-checks both; toggle exec off, move cursor away so exec shows [ ]
		stdin.write('s');      await tick(); // enter select; pendingIds = {exec, wait}
		stdin.write(' ');      await tick(); // toggle exec off at cursor=0
		stdin.write('\x1B[B'); await tick(); // move cursor to 1; exec (row 0) shows [ ]
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
		// Pre-select pre-checks both; remove wait to keep only exec
		stdin.write('s');      await tick(); // enter select; pendingIds = {exec, wait}
		stdin.write('\x1B[B'); await tick(); // down → cursor=1 (wait)
		stdin.write(' ');      await tick(); // toggle wait off → pendingIds = {exec}
		stdin.write('\r');     await tick(); // confirm → watchedIds = {exec}
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

		// commit proj-wait only: pre-select gives {exec, wait}; toggle exec off
		stdin.write('s');      await tick(); // enter select; pendingIds = {exec, wait}; cursor=0
		stdin.write(' ');      await tick(); // toggle exec off → pendingIds = {wait}
		stdin.write('\r');     await tick(); // confirm → watchedIds = {wait}

		// enter select again (only wait visible → pendingIds={wait}), toggle exec on, then esc
		stdin.write('s');      await tick(); // enter select; pendingIds = {wait}; cursor=0 (exec)
		stdin.write(' ');      await tick(); // toggle exec into pending
		stdin.write('\x1B');                 // esc — pending flush needed
		await waitEsc();
		await tick();

		const frame = lastFrame()!;
		expect(frame).toContain('proj-wait');
		expect(frame).not.toContain('proj-exec');
	});
});

// ANSI SGR codes emitted by Ink/chalk
const ANSI_INVERSE = '\x1B[7m';
const ANSI_BOLD    = '\x1B[1m';
const ANSI_YELLOW  = '\x1B[33m';

// Returns the first frame line that contains the given text.
function lineWith(frame: string, text: string): string | undefined {
	return frame.split('\n').find(l => l.includes(text));
}

// --- Watch mode: cursor ---

describe('Watch mode — cursor', () => {
	it('U22: ↓ moves watch cursor down', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('\x1B[B'); await tick(); // down arrow — cursor moves to row 1
		const frame = lastFrame()!;
		// Row 1 (proj-wait) should now be under cursor (inverse)
		expect(lineWith(frame, 'proj-wait')).toContain(ANSI_INVERSE);
	});

	it('U23: ↑ moves watch cursor up', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('\x1B[B'); await tick(); // move to row 1
		stdin.write('\x1B[A'); await tick(); // move back to row 0
		const frame = lastFrame()!;
		expect(lineWith(frame, 'proj-exec')).toContain(ANSI_INVERSE);
	});

	it('U24: watch cursor clamped at bottom', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('\x1B[B'); await tick(); // to row 1
		stdin.write('\x1B[B'); await tick(); // should stay at row 1 (clamped)
		const frame = lastFrame()!;
		expect(lineWith(frame, 'proj-wait')).toContain(ANSI_INVERSE);
		expect(lineWith(frame, 'proj-exec')).not.toContain(ANSI_INVERSE);
	});

	it('U25: watch cursor clamped at top', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('\x1B[A'); await tick(); // already at row 0, should stay
		const frame = lastFrame()!;
		expect(lineWith(frame, 'proj-exec')).toContain(ANSI_INVERSE);
	});

	it('U26: t enters settings mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('t'); await tick();
		expect(lastFrame()!).toContain('Poll interval');
	});

	it('U27: t in select mode has no effect', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick(); // enter select
		stdin.write('t'); await tick(); // should do nothing
		expect(lastFrame()!).toContain('Select sessions');
	});
});

// --- Rename mode ---

describe('Rename mode', () => {
	it('U28: r in watch mode has no effect', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('r'); await tick();
		const frame = lastFrame()!;
		expect(frame).toContain('[s]'); // still in watch mode
		expect(frame).not.toContain('_]'); // no rename input field
	});

	it('U29: r in select mode shows rename input field', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		stdin.write('r'); await tick();
		expect(lastFrame()!).toContain('_]'); // rename input field visible
	});

	it('U30: typing in rename mode appends to buffer', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		stdin.write('r'); await tick();
		stdin.write('f'); await tick();
		stdin.write('o'); await tick();
		stdin.write('o'); await tick();
		expect(lastFrame()!).toContain('foo_]');
	});

	it('U31: backspace removes last char from buffer', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		stdin.write('r'); await tick();
		stdin.write('a'); await tick();
		stdin.write('b'); await tick();
		stdin.write('\x7f'); await tick(); // backspace
		expect(lastFrame()!).toContain('a_]');
		expect(lastFrame()!).not.toContain('ab_]');
	});

	it('U32: enter confirms rename and returns to select mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		stdin.write('r'); await tick();
		stdin.write('m'); await tick();
		stdin.write('y'); await tick();
		stdin.write('\r'); await tick(); // confirm
		const frame = lastFrame()!;
		expect(frame).not.toContain('_]'); // rename field gone
		expect(frame).toContain('Select sessions'); // back in select mode
		expect(frame).toContain('my'); // custom name visible
	});

	it('U33: escape discards rename and returns to select mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		stdin.write('r'); await tick();
		stdin.write('a'); await tick();
		stdin.write('b'); await tick();
		stdin.write('c'); await tick();
		stdin.write('\x1B');  // esc from rename mode
		await waitEsc();
		await tick();
		const frame = lastFrame()!;
		expect(frame).not.toContain('_]'); // rename field gone
		expect(frame).toContain('proj-exec'); // original name preserved
	});

	it('U34: confirmed custom name appears in watch view', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		stdin.write('s'); await tick();
		stdin.write('r'); await tick();
		stdin.write('m'); await tick();
		stdin.write('y'); await tick();
		stdin.write('n'); await tick();
		stdin.write('a'); await tick();
		stdin.write('m'); await tick();
		stdin.write('e'); await tick();
		stdin.write('\r'); await tick(); // confirm rename
		stdin.write('\x1B');             // esc back to watch mode
		await waitEsc();
		await tick();
		expect(lastFrame()!).toContain('myname');
	});
});

// --- Dynamic column widths ---

describe('Dynamic column widths', () => {
	const longName = 'this-is-a-really-long-project-name'; // 34 chars, > hardcoded 24

	it('U35: name column wider than hardcoded 24 (ink-testing-library uses columns=100)', async () => {
		// ink-testing-library uses columns=100; nameWidth = max(8, 100-12-10-2) = 76
		// A 34-char name fits in 76 but would be truncated at the old hardcoded 24
		const longSession = makeSession({
			displayName: longName,
			sessionInfo: { ...executingSession.sessionInfo, sessionId: 'long-0', cwd: '/home/user/this-is-a-really-long-project-name' },
		});
		const { lastFrame } = render(
			React.createElement(Dashboard, { sessions: [longSession], onExit: vi.fn() })
		);
		await tick();
		expect(lastFrame()!).toContain(longName);
	});

	it('U36: renders without crashing when columns are limited', async () => {
		// Verifies no crash and nameWidth minimum (8) prevents negative width
		const { lastFrame } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		expect(lastFrame()).toBeTruthy();
		expect(lastFrame()!).toContain('proj-exec');
	});
});

// --- Settings mode ---

describe('Settings mode', () => {
	it('U37: t enters settings mode from watch mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('t'); await tick();
		expect(lastFrame()!).toContain('Poll interval');
	});

	it('U38: settings view renders current interval label (default 1s)', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('t'); await tick();
		expect(lastFrame()!).toContain('1s');
	});

	it('U39: → increments interval', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('t'); await tick();
		stdin.write('\x1B[C'); await tick(); // right arrow
		expect(lastFrame()!).toContain('2s');
	});

	it('U40: ← decrements interval', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('t'); await tick();
		stdin.write('\x1B[C'); await tick(); // right → 2s
		stdin.write('\x1B[D'); await tick(); // left → back to 1s
		expect(lastFrame()!).toContain('1s');
	});

	it('U41: ← at minimum does not go below 0.5s', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('t'); await tick();
		for (let i = 0; i < 10; i++) { stdin.write('\x1B[D'); await tick(); }
		expect(lastFrame()!).toContain('0.5s');
	});

	it('U42: → at maximum does not exceed 30s', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('t'); await tick();
		for (let i = 0; i < 10; i++) { stdin.write('\x1B[C'); await tick(); }
		expect(lastFrame()!).toContain('30s');
	});

	it('U43: escape returns to watch mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('t'); await tick();
		stdin.write('\x1B');
		await waitEsc();
		await tick();
		expect(lastFrame()!).toContain('[s]'); // back in watch mode
	});

	it('U44: onIntervalChange fires when interval changes', async () => {
		const onIntervalChange = vi.fn();
		const { stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession],
				onExit: vi.fn(),
				onIntervalChange,
			})
		);
		await tick();
		stdin.write('t'); await tick();
		stdin.write('\x1B[C'); await tick(); // right arrow → 2s
		expect(onIntervalChange).toHaveBeenCalledWith(2_000);
	});
});

// --- Status-change highlight ---

describe('Status-change highlight', () => {

	const execSession = makeSession({
		status: SessionStatus.Executing,
		displayName: 'proj-hi',
		sessionInfo: { pid: 2001, sessionId: 'highlight-session-id', cwd: '/home/user/proj-hi', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' },
	});
	const idleVersion = { ...execSession, status: SessionStatus.Idle };
	const backToExec  = { ...execSession, status: SessionStatus.Executing };

	// Extra tick needed: useEffect (status detection) fires after render, triggering a second render.
	const tickEffect = () => new Promise<void>(r => setTimeout(r, 0));

	it('U45: highlighted sessions sorted to top of list', async () => {
		const stable = makeSession({
			status: SessionStatus.Idle,
			displayName: 'proj-stable',
			sessionInfo: { pid: 2002, sessionId: 'stable-session-id', cwd: '/home/user/proj-stable', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' },
		});
		const { lastFrame, rerender } = render(
			React.createElement(Dashboard, { sessions: [stable, execSession], onExit: vi.fn() })
		);
		await tick();
		// Transition execSession → Idle (triggers highlight via useEffect → second render)
		rerender(React.createElement(Dashboard, { sessions: [stable, idleVersion], onExit: vi.fn() }));
		await tick();
		await tickEffect(); // let useEffect + setHighlightedIds + second render flush
		await tick();
		const frame = lastFrame()!;
		const projHiIdx     = frame.indexOf('proj-hi');
		const projStableIdx = frame.indexOf('proj-stable');
		expect(projHiIdx).toBeLessThan(projStableIdx); // highlighted appears first
	});

	it('U46: row highlighted on Executing → Idle transition', async () => {
		const { lastFrame, rerender } = render(
			React.createElement(Dashboard, { sessions: [execSession], onExit: vi.fn() })
		);
		await tick();
		rerender(React.createElement(Dashboard, { sessions: [idleVersion], onExit: vi.fn() }));
		await tick();
		await tickEffect();
		await tick();
		const frame = lastFrame()!;
		expect(frame).toContain(ANSI_BOLD);
		expect(frame).toContain(ANSI_YELLOW);
	});

	it('U47: row highlighted on Waiting → Hanging transition', async () => {
		const waitSession = makeSession({
			status: SessionStatus.Waiting,
			displayName: 'proj-w',
			sessionInfo: { pid: 2003, sessionId: 'wait-session-id', cwd: '/home/user/proj-w', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' },
		});
		const hangVersion = { ...waitSession, status: SessionStatus.Hanging };
		const { lastFrame, rerender } = render(
			React.createElement(Dashboard, { sessions: [waitSession], onExit: vi.fn() })
		);
		await tick();
		rerender(React.createElement(Dashboard, { sessions: [hangVersion], onExit: vi.fn() }));
		await tick();
		await tickEffect();
		await tick();
		const frame = lastFrame()!;
		expect(frame).toContain(ANSI_BOLD);
		expect(frame).toContain(ANSI_YELLOW);
	});

	it('U48: highlight auto-clears when status changes back to busy', async () => {
		const { lastFrame, rerender } = render(
			React.createElement(Dashboard, { sessions: [execSession], onExit: vi.fn() })
		);
		await tick();
		rerender(React.createElement(Dashboard, { sessions: [idleVersion], onExit: vi.fn() }));
		await tick(); await tickEffect(); await tick(); // let highlight propagate
		rerender(React.createElement(Dashboard, { sessions: [backToExec], onExit: vi.fn() }));
		await tick(); await tickEffect(); await tick(); // status changed again → auto-clear
		const frame = lastFrame()!;
		const hiLine = lineWith(frame, 'proj-hi');
		expect(hiLine).not.toContain(ANSI_BOLD);
	});

	it('U49: d dismisses highlight on cursor row', async () => {
		const { lastFrame, rerender, stdin } = render(
			React.createElement(Dashboard, { sessions: [execSession], onExit: vi.fn() })
		);
		await tick();
		rerender(React.createElement(Dashboard, { sessions: [idleVersion], onExit: vi.fn() }));
		await tick(); await tickEffect(); await tick(); // let highlight propagate
		stdin.write('d'); await tick(); // dismiss at cursor 0
		const frame = lastFrame()!;
		const hiLine = lineWith(frame, 'proj-hi');
		expect(hiLine).not.toContain(ANSI_BOLD);
	});

	it('U50: non-transitioning session not highlighted', async () => {
		const { lastFrame, rerender } = render(
			React.createElement(Dashboard, { sessions: [execSession], onExit: vi.fn() })
		);
		await tick();
		// Rerender with same status — no transition
		rerender(React.createElement(Dashboard, { sessions: [{ ...execSession }], onExit: vi.fn() }));
		await tick(); await tickEffect(); await tick();
		const frame = lastFrame()!;
		const hiLine = lineWith(frame, 'proj-hi');
		expect(hiLine).not.toContain(ANSI_BOLD);
	});
});

// --- UI improvements round 2 ---

// Build 10 sessions for scroll tests (more than typical terminal height).
const makeMany = (n: number): ResolvedSession[] =>
	Array.from({ length: n }, (_, i) =>
		makeSession({
			status: SessionStatus.Idle,
			displayName: `scroll-sess-${i}`,
			sessionInfo: {
				pid: 3000 + i,
				sessionId: `scroll-id-${i}`,
				cwd: `/home/user/scroll-${i}`,
				startedAt: 1_000_000_000_000,
				kind: 'interactive',
				entrypoint: 'cli',
			},
		})
	);

describe('Vertical scroll', () => {
	it('V1: with more sessions than terminal height, only a subset is shown', async () => {
		// ink-testing-library sets rows to 24 by default; 20 sessions > usable space
		const sessions = makeMany(20);
		const { lastFrame } = render(
			React.createElement(Dashboard, { sessions, onExit: vi.fn() })
		);
		await tick();
		const frame = lastFrame()!;
		// Not all 20 should appear — some are off-screen
		const visibleCount = sessions.filter(s => frame.includes(s.displayName)).length;
		expect(visibleCount).toBeLessThan(20);
	});

	it('V2: moving cursor down scrolls viewport so new rows become visible', async () => {
		const sessions = makeMany(20);
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions, onExit: vi.fn() })
		);
		await tick();
		const frameA = lastFrame()!;
		// Move cursor far down
		for (let i = 0; i < 15; i++) { stdin.write('j'); await tick(); }
		const frameB = lastFrame()!;
		expect(frameA).not.toEqual(frameB);
		// scroll-sess-15 should now be visible
		expect(frameB).toContain('scroll-sess-15');
	});

	it('V3: scroll indicator "↓" appears when content overflows below', async () => {
		const sessions = makeMany(20);
		const { lastFrame } = render(
			React.createElement(Dashboard, { sessions, onExit: vi.fn() })
		);
		await tick();
		expect(lastFrame()!).toContain('↓');
	});
});

describe('Quick hide', () => {
	const hideSess = makeSession({
		status: SessionStatus.Idle,
		displayName: 'hide-me',
		sessionInfo: { pid: 4001, sessionId: 'hide-id-1', cwd: '/home/user/hide-me', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' },
	});
	const otherSess = makeSession({
		status: SessionStatus.Idle,
		displayName: 'keep-me',
		sessionInfo: { pid: 4002, sessionId: 'hide-id-2', cwd: '/home/user/keep-me', startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli' },
	});

	it('V4: x in watch mode removes cursor session from watch view', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [hideSess, otherSess], onExit: vi.fn() })
		);
		await tick();
		expect(lastFrame()!).toContain('hide-me');
		stdin.write('x'); await tick();
		expect(lastFrame()!).not.toContain('hide-me');
	});

	it('V5: hidden session shows [~] marker in select mode', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [hideSess, otherSess], onExit: vi.fn() })
		);
		await tick();
		stdin.write('x'); await tick(); // hide cursor row (hide-me)
		stdin.write('s'); await tick(); // enter select mode — cursor at 0 (hide-me, hidden)
		stdin.write('j'); await tick(); // move cursor to row 1 — hide-me now shows [~]
		expect(lastFrame()!).toContain('[~]');
	});

	it('V6: space on [~] session unhides and checks it', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [hideSess, otherSess], onExit: vi.fn() })
		);
		await tick();
		stdin.write('x'); await tick(); // hide hide-me (cursor row 0)
		stdin.write('s'); await tick(); // enter select — cursor on hide-me (or first visible)
		stdin.write(' '); await tick(); // toggle: unhide + check
		const frame = lastFrame()!;
		// [~] should be gone; hide-me should have a check
		expect(frame).not.toContain('[~]');
		expect(frame).toContain('[✓]');
	});

	it('V7: x key in select mode has no effect', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [hideSess, otherSess], onExit: vi.fn() })
		);
		await tick();
		stdin.write('s'); await tick(); // enter select
		const frameBefore = lastFrame()!;
		stdin.write('x'); await tick();
		expect(lastFrame()!).toEqual(frameBefore);
	});
});

describe('Pre-select visible sessions', () => {
	it('V8: entering select mode pre-checks all currently visible sessions', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession, waitingSession, idleSession], onExit: vi.fn() })
		);
		await tick();
		stdin.write('s'); await tick(); // enter select
		const frame = lastFrame()!;
		// No session should be unchecked — all show [✓] or [►] (cursor), never [ ]
		expect(frame).not.toContain('[ ]');
	});
});

describe('Title bar', () => {
	it('V9: "CA Dashboard" appears in all modes', async () => {
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, { sessions: [executingSession], onExit: vi.fn() })
		);
		await tick();
		expect(lastFrame()!).toContain('CA Dashboard'); // watch mode

		stdin.write('s'); await tick();
		expect(lastFrame()!).toContain('CA Dashboard'); // select mode

		stdin.write('\x1B'); await waitEsc();
		expect(lastFrame()!).toContain('CA Dashboard'); // back to watch

		stdin.write('t'); await tick();
		expect(lastFrame()!).toContain('CA Dashboard'); // settings mode
	});
});

describe('Status counts', () => {
	it('V10: status count bar shows correct per-status counts', async () => {
		const { lastFrame } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, waitingSession, idleSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		const frame = lastFrame()!;
		expect(frame).toContain('1 executing');
		expect(frame).toContain('1 waiting');
		expect(frame).toContain('1 idle');
	});

	it('V11: status counts reflect ALL sessions, not just watched', async () => {
		// deadSession is filtered from watch view but should appear in counts
		const { lastFrame, stdin } = render(
			React.createElement(Dashboard, {
				sessions: [executingSession, deadSession],
				onExit: vi.fn(),
			})
		);
		await tick();
		// Enter select, watch only the executing session
		stdin.write('s'); await tick();
		stdin.write(' '); await tick(); // toggle off exec (all pre-checked → deselect)
		stdin.write('\r'); await tick(); // confirm — watchedIds = {} (exec deselected, dead not shown)
		const frame = lastFrame()!;
		// Dead session still in counts even though not in watch view
		expect(frame).toContain('1 dead');
	});
});
