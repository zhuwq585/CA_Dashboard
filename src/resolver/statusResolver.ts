import path from 'node:path';
import { x } from 'tinyexec';
import { SessionInfo, SessionStatus, ResolvedSession } from '../types.js';
import { ConversationLogReader } from '../jsonl/conversationLogReader.js';

const HANGING_THRESHOLD_MS = 120 * 60 * 1000; // 120 minutes

// Persistent helper processes Claude Code spawns to keep the system awake.
// They appear in pgrep output even when no tool is running, so they must be
// filtered out before deciding whether a "real" tool child is active.
//   macOS:  caffeinate
//   Linux:  systemd-inhibit
// Tool host shells (zsh/bash/sh) are deliberately NOT listed here: when a
// Bash tool is genuinely executing, the shell is the active host of that
// command and we want it counted as a real child.
const HELPER_PROCESSES = ['caffeinate', 'systemd-inhibit'];

export interface StatusResolverOptions {
	hangingThresholdMs?: number;
	helperProcesses?: string[];
	logReader?: ConversationLogReader;
}

// Returns the maximum of two optional epoch-ms values, or undefined if both are absent.
function pickLatest(a: number | undefined, b: number | undefined): number | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return Math.max(a, b);
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
// Uses 'pgrep -l' (NOT '-a'): -l is supported on both macOS BSD pgrep and
// Linux procps pgrep, and outputs "pid name" (just the short command, no args).
// On macOS, '-a' is silently treated as a search pattern matching 'a' in the
// command name — a subtle bug that masked all real children.
async function getChildCommands(pid: number): Promise<string[]> {
	try {
		const result = await x('pgrep', ['-P', String(pid), '-l']);
		return result.stdout
			.split('\n')
			.map((line) => {
				const parts = line.trim().split(/\s+/);
				return parts.length >= 2 ? path.basename(parts[1]) : '';
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

export class StatusResolver {
	private readonly hangingThresholdMs: number;
	private readonly helperProcesses: string[];
	private readonly logReader: ConversationLogReader;

	constructor(options?: StatusResolverOptions) {
		this.hangingThresholdMs = options?.hangingThresholdMs ?? HANGING_THRESHOLD_MS;
		this.helperProcesses = options?.helperProcesses ?? HELPER_PROCESSES;
		this.logReader = options?.logReader ?? new ConversationLogReader();
	}

	// Resolves the status of all sessions concurrently.
	async resolve(sessions: SessionInfo[]): Promise<ResolvedSession[]> {
		return Promise.all(sessions.map((session) => this.resolveOne(session)));
	}

	// Applies the JSONL-driven decision tree to a single session.
	private async resolveOne(session: SessionInfo): Promise<ResolvedSession> {
		const displayName = resolveDisplayName(session);
		const resolvedAt = Date.now();

		if (!(await isPidAlive(session.pid))) {
			return { sessionInfo: session, status: SessionStatus.Dead, displayName, resolvedAt };
		}

		const { state, mtimeMs } = await this.logReader.readState(session.cwd, session.sessionId);

		// Most recent of session.updatedAt and JSONL mtime — used for Hanging check and
		// rendered as "Last Active" by the UI. Falls back gracefully when either is missing.
		const lastActiveMs = pickLatest(session.updatedAt, mtimeMs);
		const make = (status: SessionStatus): ResolvedSession => ({
			sessionInfo: session,
			status,
			displayName,
			resolvedAt,
			lastActiveMs,
		});

		// Hanging only when ALL available activity signals are stale. A long-running tool
		// can leave the JSONL untouched for minutes while session.updatedAt keeps ticking
		// (or vice versa during an approval prompt) — either signal being fresh means the
		// session is alive, so don't flag Hanging.
		const ages: number[] = [];
		if (session.updatedAt !== undefined) ages.push(resolvedAt - session.updatedAt);
		if (mtimeMs !== undefined) ages.push(resolvedAt - mtimeMs);
		if (ages.length > 0 && ages.every((age) => age >= this.hangingThresholdMs)) {
			return make(SessionStatus.Hanging);
		}

		// Claude Code writes status='waiting' (and waitingFor) directly when blocked on
		// user approval. Trust this — it avoids false Executing classifications when the
		// tool's host shell (zsh/bash) is already spawned but the command hasn't started.
		if (session.status === 'waiting') return make(SessionStatus.Waiting);

		if (state.kind === 'pendingToolApproval') {
			const childCommands = await getChildCommands(session.pid);
			const realChildren = childCommands.filter((cmd) => !this.helperProcesses.includes(cmd));
			return make(realChildren.length > 0 ? SessionStatus.Executing : SessionStatus.Waiting);
		}

		if (state.kind === 'userTurn') return make(SessionStatus.Executing);
		// A rejected tool with no correction halts the conversation — nothing is running.
		if (state.kind === 'userRejectedTool') return make(SessionStatus.Idle);
		if (state.kind === 'assistantDone') return make(SessionStatus.Idle);
		return make(SessionStatus.Idle);
	}
}
