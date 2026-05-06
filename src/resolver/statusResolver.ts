import path from 'node:path';
import { x } from 'tinyexec';
import { SessionInfo, SessionStatus, ResolvedSession } from '../types.js';

const HANGING_THRESHOLD_MS = 120_000;
const HELPER_PROCESSES = ['caffeinate'];

export interface StatusResolverOptions {
	hangingThresholdMs?: number;
	helperProcesses?: string[];
}

export function resolveDisplayName(session: SessionInfo): string {
	if (session.name) return session.name;
	const base = path.basename(session.cwd);
	if (base && base !== '/') return base;
	return session.sessionId.slice(0, 8);
}

async function isPidAlive(pid: number): Promise<boolean> {
	try {
		await x('ps', ['-p', String(pid)]);
		return true;
	} catch {
		return false;
	}
}

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

	async resolve(sessions: SessionInfo[]): Promise<ResolvedSession[]> {
		return Promise.all(sessions.map(session => this.resolveOne(session)));
	}

	private async resolveOne(session: SessionInfo): Promise<ResolvedSession> {
		const displayName = resolveDisplayName(session);
		const resolvedAt = Date.now();

		if (!await isPidAlive(session.pid)) {
			return { session, status: SessionStatus.Dead, displayName, resolvedAt };
		}

		if (session.status === undefined) {
			return { session, status: SessionStatus.Idle, displayName, resolvedAt };
		}

		if (session.status !== 'busy') {
			return { session, status: SessionStatus.Idle, displayName, resolvedAt };
		}

		if (session.updatedAt !== undefined && (Date.now() - session.updatedAt) >= this.hangingThresholdMs) {
			return { session, status: SessionStatus.Hanging, displayName, resolvedAt };
		}

		const childCommands = await getChildCommands(session.pid);
		const realChildren = childCommands.filter(cmd => !this.helperProcesses.includes(cmd));

		if (realChildren.length > 0) {
			return { session, status: SessionStatus.Executing, displayName, resolvedAt };
		}

		return { session, status: SessionStatus.Waiting, displayName, resolvedAt };
	}
}
