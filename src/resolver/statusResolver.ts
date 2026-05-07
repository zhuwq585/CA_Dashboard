import path from 'node:path';
import { x } from 'tinyexec';
import { SessionInfo, SessionStatus, ResolvedSession } from '../types.js';

const HANGING_THRESHOLD_MS = 120_000;
const HELPER_PROCESSES = ['caffeinate'];

export interface StatusResolverOptions {
	hangingThresholdMs?: number;
	helperProcesses?: string[];
}

// Returns the best human-readable name for a session.
export function resolveDisplayName(session: SessionInfo): string {
	if (session.name) return session.name;
	const base = path.basename(session.cwd);
	if (base && base !== '/') return base;
	return session.sessionId.slice(0, 8);
}

// Returns true if the process with the given PID is running.
async function isPidAlive(pid: number): Promise<boolean> {
	try {
		await x('ps', ['-p', String(pid)]);
		return true;
	} catch {
		return false;
	}
}

// Returns the command names of all child processes of the given PID.
async function getChildCommands(pid: number): Promise<string[]> {
	try {
		const result = await x('pgrep', ['-P', String(pid), '-a']);
		return result.stdout
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export class StatusResolver {
	private readonly hangingThresholdMs: number;
	private readonly helperProcesses: string[];

	constructor(options?: StatusResolverOptions) {
		this.hangingThresholdMs = options?.hangingThresholdMs ?? HANGING_THRESHOLD_MS;
		this.helperProcesses = options?.helperProcesses ?? HELPER_PROCESSES;
	}

	// Resolves the status of all sessions concurrently.
	async resolve(sessions: SessionInfo[]): Promise<ResolvedSession[]> {
		return Promise.all(sessions.map(session => this.resolveOne(session)));
	}

	// Applies the decision tree to a single session and returns its resolved state.
	private async resolveOne(session: SessionInfo): Promise<ResolvedSession> {
		const displayName = resolveDisplayName(session);
		const resolvedAt = Date.now();

		if (!await isPidAlive(session.pid)) {
			return { sessionInfo: session, status: SessionStatus.Dead, displayName, resolvedAt };
		}

		if (session.status === undefined) {
			return { sessionInfo: session, status: SessionStatus.Idle, displayName, resolvedAt };
		}

		if (session.status !== 'busy') {
			return { sessionInfo: session, status: SessionStatus.Idle, displayName, resolvedAt };
		}

		if (session.updatedAt !== undefined && (Date.now() - session.updatedAt) >= this.hangingThresholdMs) {
			return { sessionInfo: session, status: SessionStatus.Hanging, displayName, resolvedAt };
		}

		const childCommands = await getChildCommands(session.pid);
		const realChildren = childCommands.filter(cmd => !this.helperProcesses.includes(cmd));

		if (realChildren.length > 0) {
			return { sessionInfo: session, status: SessionStatus.Executing, displayName, resolvedAt };
		}

		return { sessionInfo: session, status: SessionStatus.Waiting, displayName, resolvedAt };
	}
}
