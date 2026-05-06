import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	vi,
} from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionFileWatcher, type SessionsChangedCallback } from './sessionFileWatcher.js';
import type { SessionInfo } from '../types.js';

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

async function writeSession(dir: string, filename: string, session: SessionInfo): Promise<void> {
	await fs.writeFile(path.join(dir, filename), JSON.stringify(session));
}

async function waitForWatchEvent(ms = 100): Promise<void> {
	// FSEvents on macOS coalesces notifications and can take ~50ms real time
	// to deliver them. We use the real (unfaked) setTimeout so this wait is
	// measured in wall-clock time, not fake-timer ticks.
	await new Promise<void>(resolve => realSetTimeout(resolve, ms));
}

let tmpDir: string;
let watcher: SessionFileWatcher;
// Capture the real setTimeout before vi.useFakeTimers replaces it,
// so waitForWatchEvent can wait real wall-clock time for FSEvents delivery.
let realSetTimeout: typeof globalThis.setTimeout;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ca-dashboard-test-'));
	realSetTimeout = globalThis.setTimeout;
	vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
});

afterEach(async () => {
	watcher?.stop();
	vi.useRealTimers();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SessionFileWatcher', () => {
	it('W1: initial scan emits existing files', async () => {
		await writeSession(tmpDir, '1234.json', minimalSession);
		await writeSession(tmpDir, '5678.json', { ...minimalSession, pid: 5678, sessionId: 'bbbbbbbb-0000-0000-0000-000000000000' });

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir });
		watcher.start(onChanged);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(1);
		expect(onChanged.mock.calls[0][0]).toHaveLength(2);
	});

	it('W2: empty directory emits empty array', async () => {
		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir });
		watcher.start(onChanged);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(1);
		expect(onChanged.mock.calls[0][0]).toEqual([]);
	});

	it('W3: new file triggers update after debounce', async () => {
		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir, debounceMs: 100 });
		watcher.start(onChanged);
		await waitForWatchEvent();

		await writeSession(tmpDir, '9999.json', { ...minimalSession, pid: 9999, sessionId: 'cccccccc-0000-0000-0000-000000000000' });
		await waitForWatchEvent();
		await vi.advanceTimersByTimeAsync(100);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(2);
		const sessions = onChanged.mock.calls[1][0];
		expect(sessions.some(s => s.pid === 9999)).toBe(true);
	});

	it('W4: file change triggers update', async () => {
		await writeSession(tmpDir, '1234.json', minimalSession);

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir, debounceMs: 100 });
		watcher.start(onChanged);
		await waitForWatchEvent();

		await writeSession(tmpDir, '1234.json', { ...minimalSession, pid: 9000 });
		await waitForWatchEvent();
		await vi.advanceTimersByTimeAsync(100);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(2);
		expect(onChanged.mock.calls[1][0][0].pid).toBe(9000);
	});

	it('W5: file deletion triggers update', async () => {
		await writeSession(tmpDir, '1234.json', minimalSession);
		await writeSession(tmpDir, '5678.json', { ...minimalSession, pid: 5678, sessionId: 'bbbbbbbb-0000-0000-0000-000000000000' });

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir, debounceMs: 100 });
		watcher.start(onChanged);
		await waitForWatchEvent();

		await fs.unlink(path.join(tmpDir, '5678.json'));
		await waitForWatchEvent();
		await vi.advanceTimersByTimeAsync(100);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(2);
		expect(onChanged.mock.calls[1][0]).toHaveLength(1);
	});

	it('W6: debounce coalesces rapid events', async () => {
		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir, debounceMs: 100 });
		watcher.start(onChanged);
		await waitForWatchEvent();

		// Write 5 files rapidly without advancing timers
		for (let i = 0; i < 5; i++) {
			await writeSession(tmpDir, `${i}.json`, { ...minimalSession, pid: i, sessionId: `${i}aaaaaaa-0000-0000-0000-000000000000` });
			await waitForWatchEvent();
		}

		// Advance past debounce once
		await vi.advanceTimersByTimeAsync(100);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(2);
	});

	it('W7: periodic tick fires without file events', async () => {
		const onChanged = vi.fn<SessionsChangedCallback>();
		// Large debounceMs ensures any spurious fs.watch startup event on macOS
		// doesn't create a debounce timer that fires within our 1000ms tick window.
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir, tickIntervalMs: 1000, debounceMs: 5000 });
		watcher.start(onChanged);
		await waitForWatchEvent();

		await vi.advanceTimersByTimeAsync(1000);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(2);
	});

	it('W8: JSON parse error retains previous valid value', async () => {
		await writeSession(tmpDir, '1234.json', minimalSession);

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir, debounceMs: 100 });
		watcher.start(onChanged);
		await waitForWatchEvent();

		// Overwrite with invalid JSON
		await fs.writeFile(path.join(tmpDir, '1234.json'), 'not valid json {{{');
		await waitForWatchEvent();
		await vi.advanceTimersByTimeAsync(100);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(2);
		expect(onChanged.mock.calls[1][0]).toHaveLength(1);
		expect(onChanged.mock.calls[1][0][0].pid).toBe(minimalSession.pid);
	});

	it('W9: first-encounter parse error skipped silently', async () => {
		await fs.writeFile(path.join(tmpDir, 'bad.json'), 'not valid json {{{');

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir });

		// Check start() doesn't throw synchronously, then wait for the async scan.
		expect(() => watcher.start(onChanged)).not.toThrow();
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(1);
		expect(onChanged.mock.calls[0][0]).toEqual([]);
	});

	it('W10: non-JSON files are ignored', async () => {
		await fs.writeFile(path.join(tmpDir, 'notes.txt'), 'hello');
		await writeSession(tmpDir, 'valid.json', minimalSession);

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir });
		watcher.start(onChanged);
		await waitForWatchEvent();

		expect(onChanged).toHaveBeenCalledTimes(1);
		expect(onChanged.mock.calls[0][0]).toHaveLength(1);
		expect(onChanged.mock.calls[0][0][0].pid).toBe(minimalSession.pid);
	});

	it('W11: stop() prevents further callbacks', async () => {
		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir, tickIntervalMs: 1000, debounceMs: 100 });
		watcher.start(onChanged);
		await waitForWatchEvent();

		watcher.stop();
		await vi.advanceTimersByTimeAsync(2000);

		expect(onChanged).toHaveBeenCalledTimes(1);
	});

	it('W12: old schema parsed correctly', async () => {
		const old = { pid: 1234, sessionId: 'aaaaaaaa-0000-0000-0000-000000000000', cwd: '/home/user/project', startedAt: 1000000000000 };
		await fs.writeFile(path.join(tmpDir, '1234.json'), JSON.stringify(old));

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir });
		watcher.start(onChanged);
		await waitForWatchEvent();

		const session = onChanged.mock.calls[0][0][0];
		expect(session.pid).toBe(1234);
		expect(session.sessionId).toBe('aaaaaaaa-0000-0000-0000-000000000000');
		expect(session.cwd).toBe('/home/user/project');
		expect(session.startedAt).toBe(1000000000000);
		expect(session.name).toBeUndefined();
		expect(session.updatedAt).toBeUndefined();
	});

	it('W13: full schema parsed correctly', async () => {
		await writeSession(tmpDir, '1234.json', fullSession);

		const onChanged = vi.fn<SessionsChangedCallback>();
		watcher = new SessionFileWatcher({ sessionsDir: tmpDir });
		watcher.start(onChanged);
		await waitForWatchEvent();

		const session = onChanged.mock.calls[0][0][0];
		expect(session.pid).toBe(fullSession.pid);
		expect(session.sessionId).toBe(fullSession.sessionId);
		expect(session.name).toBe(fullSession.name);
		expect(session.version).toBe(fullSession.version);
		expect(session.peerProtocol).toBe(fullSession.peerProtocol);
		expect(session.kind).toBe(fullSession.kind);
		expect(session.entrypoint).toBe(fullSession.entrypoint);
		expect(session.status).toBe(fullSession.status);
		expect(session.updatedAt).toBe(fullSession.updatedAt);
	});
});
