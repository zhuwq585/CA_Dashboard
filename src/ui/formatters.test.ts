import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionStatus } from '../types.js';
import { formatStatus, formatRelativeTime } from './formatters.js';

describe('formatStatus', () => {
	it('F1: Executing', () => {
		expect(formatStatus(SessionStatus.Executing)).toBe('⚙ Executing');
	});
	it('F2: Waiting', () => {
		expect(formatStatus(SessionStatus.Waiting)).toBe('⏳ Waiting');
	});
	it('F3: Idle', () => {
		expect(formatStatus(SessionStatus.Idle)).toBe('✓ Idle');
	});
	it('F4: Hanging', () => {
		expect(formatStatus(SessionStatus.Hanging)).toBe('⚠ Hanging');
	});
	it('F5: Dead', () => {
		expect(formatStatus(SessionStatus.Dead)).toBe('✗ Dead');
	});
});

describe('formatRelativeTime', () => {
	const now = 1_000_000_000_000;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('F6: undefined returns unknown', () => {
		expect(formatRelativeTime(undefined)).toBe('unknown');
	});
	it('F7: now - 0 returns just now', () => {
		expect(formatRelativeTime(now - 0)).toBe('just now');
	});
	it('F8: now - 9999 returns just now', () => {
		expect(formatRelativeTime(now - 9_999)).toBe('just now');
	});
	it('F9: now - 10000 returns 10s ago', () => {
		expect(formatRelativeTime(now - 10_000)).toBe('10s ago');
	});
	it('F10: now - 59000 returns 59s ago', () => {
		expect(formatRelativeTime(now - 59_000)).toBe('59s ago');
	});
	it('F11: now - 60000 returns 1m ago', () => {
		expect(formatRelativeTime(now - 60_000)).toBe('1m ago');
	});
	it('F12: now - 119000 returns 1m ago', () => {
		expect(formatRelativeTime(now - 119_000)).toBe('1m ago');
	});
	it('F13: now - 3600000 returns 1h ago', () => {
		expect(formatRelativeTime(now - 3_600_000)).toBe('1h ago');
	});
	it('F14: now - 7200000 returns 2h ago', () => {
		expect(formatRelativeTime(now - 7_200_000)).toBe('2h ago');
	});
});
