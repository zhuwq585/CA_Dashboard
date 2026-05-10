import React, { useState, useRef, useEffect } from 'react';
import { useInput } from 'ink';
import { SessionStatus } from '../types.js';
import type { ResolvedSession } from '../types.js';
import { WatchView } from './WatchView.js';
import { SelectView } from './SelectView.js';
import { SettingsView } from './SettingsView.js';

const PRESETS_MS    = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
const PRESET_LABELS = ['0.5s', '1s', '2s', '5s', '10s', '30s'] as const;

const BUSY_STATUSES      = new Set([SessionStatus.Executing, SessionStatus.Waiting]);
const ATTENTION_STATUSES = new Set([SessionStatus.Idle, SessionStatus.Hanging, SessionStatus.Dead]);

interface DashboardProps {
	sessions:          ResolvedSession[];
	onExit:            () => void;
	onIntervalChange?: (ms: number) => void;
}

export function Dashboard({ sessions, onExit, onIntervalChange }: DashboardProps): React.ReactElement {
	const [mode, setMode]               = useState<'watch' | 'select' | 'rename' | 'settings'>('watch');
	const [watchedIds, setWatchedIds]   = useState<Set<string>>(new Set());
	const [pendingIds, setPendingIds]   = useState<Set<string>>(new Set());
	const [cursor, setCursor]           = useState<number>(0);
	const [watchCursor, setWatchCursor] = useState<number>(0);
	const [customNames, setCustomNames] = useState<Map<string, string>>(new Map());
	const [renameBuffer, setRenameBuffer] = useState<string>('');
	const [intervalIdx, setIntervalIdx] = useState<number>(1);
	const prevStatusesRef = useRef<Map<string, SessionStatus>>(new Map());
	const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());

	// Detect status transitions and update highlightedIds.
	useEffect(() => {
		const prev = prevStatusesRef.current;
		setHighlightedIds(current => {
			const next = new Set(current);
			for (const s of sessions) {
				const id = s.sessionInfo.sessionId;
				const prevStatus = prev.get(id);
				if (prevStatus !== undefined && prevStatus !== s.status) {
					if (BUSY_STATUSES.has(prevStatus) && ATTENTION_STATUSES.has(s.status)) {
						next.add(id);
					} else {
						next.delete(id);
					}
				}
				prev.set(id, s.status);
			}
			return next;
		});
	}, [sessions]);

	// Sort highlighted sessions to top.
	const sortedSessions = [
		...sessions.filter(s => highlightedIds.has(s.sessionInfo.sessionId)),
		...sessions.filter(s => !highlightedIds.has(s.sessionInfo.sessionId)),
	];

	const selectSessions = sortedSessions;

	const clampedCursor = Math.min(cursor, Math.max(0, selectSessions.length - 1));

	const watchSessions = watchedIds.size === 0
		? sortedSessions.filter(s => s.status !== SessionStatus.Dead)
		: sortedSessions.filter(s => watchedIds.has(s.sessionInfo.sessionId) && s.status !== SessionStatus.Dead);

	const clampedWatchCursor = Math.min(watchCursor, Math.max(0, watchSessions.length - 1));

	useInput((input, key) => {
		if (mode === 'watch') {
			if (key.upArrow || input === 'k') {
				setWatchCursor(c => Math.max(0, c - 1));
			} else if (key.downArrow || input === 'j') {
				setWatchCursor(c => Math.min(watchSessions.length - 1, c + 1));
			} else if (input === 'd') {
				const id = watchSessions[clampedWatchCursor]?.sessionInfo.sessionId;
				if (id) setHighlightedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
			} else if (input === 's') {
				setPendingIds(new Set(watchedIds));
				setCursor(0);
				setMode('select');
			} else if (input === 't') {
				setMode('settings');
			} else if (input === 'q') {
				onExit();
			}
		} else if (mode === 'select') {
			const n = selectSessions.length;
			if (n === 0) return;
			if (key.upArrow || input === 'k') {
				setCursor(c => (c - 1 + n) % n);
			} else if (key.downArrow || input === 'j') {
				setCursor(c => (c + 1) % n);
			} else if (input === ' ') {
				const id = selectSessions[clampedCursor]?.sessionInfo.sessionId;
				if (id) {
					setPendingIds(prev => {
						const next = new Set(prev);
						if (next.has(id)) next.delete(id); else next.add(id);
						return next;
					});
				}
			} else if (input === 'r') {
				const s = selectSessions[clampedCursor];
				if (s) {
					const name = customNames.get(s.sessionInfo.sessionId) ?? s.displayName;
					setRenameBuffer(name);
					setMode('rename');
				}
			} else if (key.return) {
				setWatchedIds(new Set(pendingIds));
				setMode('watch');
			} else if (key.escape) {
				setMode('watch');
			}
		} else if (mode === 'rename') {
			if (key.return) {
				const s = selectSessions[clampedCursor];
				if (s) {
					const id = s.sessionInfo.sessionId;
					const trimmed = renameBuffer.trim();
					setCustomNames(prev => {
						const next = new Map(prev);
						if (trimmed) next.set(id, trimmed); else next.delete(id);
						return next;
					});
				}
				setMode('select');
			} else if (key.escape) {
				setRenameBuffer('');
				setMode('select');
			} else if (input === '\x7f' || key.backspace) {
				setRenameBuffer(b => b.slice(0, -1));
			} else if (input && !key.ctrl && !key.meta) {
				setRenameBuffer(b => b + input);
			}
		} else if (mode === 'settings') {
			if (key.leftArrow || input === 'h') {
				const newIdx = Math.max(0, intervalIdx - 1);
				setIntervalIdx(newIdx);
				if (newIdx !== intervalIdx) onIntervalChange?.(PRESETS_MS[newIdx]);
			} else if (key.rightArrow || input === 'l') {
				const newIdx = Math.min(PRESETS_MS.length - 1, intervalIdx + 1);
				setIntervalIdx(newIdx);
				if (newIdx !== intervalIdx) onIntervalChange?.(PRESETS_MS[newIdx]);
			} else if (key.escape) {
				setMode('watch');
			}
		}
	});

	if (mode === 'select' || mode === 'rename') {
		return (
			<SelectView
				sessions={selectSessions}
				checkedIds={pendingIds}
				cursor={clampedCursor}
				customNames={customNames}
				isRenaming={mode === 'rename'}
				renameValue={renameBuffer}
				onCursorMove={delta => setCursor(c => (c + delta + selectSessions.length) % selectSessions.length)}
				onToggle={() => {
					const id = selectSessions[clampedCursor]?.sessionInfo.sessionId;
					if (id) {
						setPendingIds(prev => {
							const next = new Set(prev);
							if (next.has(id)) next.delete(id); else next.add(id);
							return next;
						});
					}
				}}
				onConfirm={() => { setWatchedIds(new Set(pendingIds)); setMode('watch'); }}
				onCancel={() => setMode('watch')}
			/>
		);
	}

	if (mode === 'settings') {
		return (
			<SettingsView
				intervalMs={PRESETS_MS[intervalIdx]}
				presets={PRESETS_MS}
				labels={PRESET_LABELS}
			/>
		);
	}

	return <WatchView sessions={watchSessions} cursor={clampedWatchCursor} highlightedIds={highlightedIds} customNames={customNames} />;
}
