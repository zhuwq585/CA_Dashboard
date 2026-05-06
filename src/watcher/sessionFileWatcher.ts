import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SessionInfo } from '../types.js';

export interface SessionFileWatcherOptions {
	sessionsDir?:    string;
	debounceMs?:     number;
	tickIntervalMs?: number;
}

export type SessionsChangedCallback = (sessions: SessionInfo[]) => void;

export class SessionFileWatcher {
	private sessionsDir: string;
	private debounceMs: number;
	private tickIntervalMs: number;

	private cache = new Map<string, SessionInfo>();
	private active = false;
	private fsWatcher: fs.FSWatcher | null = null;
	private tickTimer: ReturnType<typeof setInterval> | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private onChanged: SessionsChangedCallback | null = null;

	// Stores options with defaults applied.
	constructor(options?: SessionFileWatcherOptions) {
		this.sessionsDir = options?.sessionsDir ?? path.join(os.homedir(), '.claude', 'sessions');
		this.debounceMs  = options?.debounceMs     ?? 100;
		this.tickIntervalMs = options?.tickIntervalMs ?? 1000;
	}

	// Runs an immediate scan, then watches for file changes and periodic ticks.
	start(onChanged: SessionsChangedCallback): void {
		this.active = true;
		this.onChanged = onChanged;

		void this.scan().then(sessions => {
			if (this.active) onChanged(sessions);
		});

		this.fsWatcher = fs.watch(this.sessionsDir, () => {
			this.scheduleScan();
		});

		this.tickTimer = setInterval(() => {
			void this.scan().then(sessions => {
				if (this.active && this.onChanged) this.onChanged(sessions);
			});
		}, this.tickIntervalMs);
	}

	// Cancels the watcher, tick timer, and any pending debounce; no callbacks fire after this returns.
	stop(): void {
		this.active = false;
		this.onChanged = null;

		this.fsWatcher?.close();
		this.fsWatcher = null;

		if (this.tickTimer !== null) {
			clearInterval(this.tickTimer);
			this.tickTimer = null;
		}

		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	// Resets the debounce timer so rapid watch events coalesce into one scan.
	private scheduleScan(): void {
		if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			void this.scan().then(sessions => {
				if (this.active && this.onChanged) this.onChanged(sessions);
			});
		}, this.debounceMs);
	}

	// Reads all *.json files in sessionsDir and returns parsed SessionInfo objects.
	private async scan(): Promise<SessionInfo[]> {
		let entries: string[];
		try {
			entries = await fsp.readdir(this.sessionsDir);
		} catch {
			return [];
		}

		const newCache = new Map<string, SessionInfo>();

		for (const filename of entries.filter(e => e.endsWith('.json'))) {
			try {
				const raw = await fsp.readFile(path.join(this.sessionsDir, filename), 'utf-8');
				newCache.set(filename, JSON.parse(raw) as SessionInfo);
			} catch {
				const prev = this.cache.get(filename);
				if (prev !== undefined) newCache.set(filename, prev);
			}
		}

		this.cache = newCache;
		return Array.from(newCache.values());
	}
}
