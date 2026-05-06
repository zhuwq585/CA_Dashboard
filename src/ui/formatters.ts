import { SessionStatus } from '../types.js';

export function formatStatus(status: SessionStatus): string {
	switch (status) {
		case SessionStatus.Executing: return '⚙ Executing';
		case SessionStatus.Waiting:   return '⏳ Waiting';
		case SessionStatus.Idle:      return '✓ Idle';
		case SessionStatus.Hanging:   return '⚠ Hanging';
		case SessionStatus.Dead:      return '✗ Dead';
	}
}

export function formatRelativeTime(epochMs: number | undefined): string {
	if (epochMs === undefined) return 'unknown';
	const age = Date.now() - epochMs;
	if (age < 10_000)       return 'just now';
	if (age < 60_000)       return `${Math.floor(age / 1_000)}s ago`;
	if (age < 3_600_000)    return `${Math.floor(age / 60_000)}m ago`;
	return `${Math.floor(age / 3_600_000)}h ago`;
}
