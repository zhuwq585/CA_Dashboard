import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionStatus } from '../types.js';
import type { ResolvedSession } from '../types.js';
import { WatchView } from './WatchView.js';
import { SelectView } from './SelectView.js';
import { SettingsView } from './SettingsView.js';

const PRESETS_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
const PRESET_LABELS = ['0.5s', '1s', '2s', '5s', '10s', '30s'] as const;

const BUSY_STATUSES = new Set([SessionStatus.Executing, SessionStatus.Waiting]);
const ATTENTION_STATUSES = new Set([SessionStatus.Idle, SessionStatus.Hanging, SessionStatus.Dead]);

const SortMethod = { Time: 'time', Status: 'status', Name: 'name' } as const;
type SortMethod = (typeof SortMethod)[keyof typeof SortMethod];

const STATUS_RANK: Record<SessionStatus, number> = {
	[SessionStatus.Executing]: 0,
	[SessionStatus.Waiting]: 1,
	[SessionStatus.Idle]: 2,
	[SessionStatus.Hanging]: 3,
	[SessionStatus.Dead]: 4,
};

const SORT_METHODS: SortMethod[] = [SortMethod.Time, SortMethod.Status, SortMethod.Name];

const SORT_LABELS: Record<SortMethod, string> = {
	[SortMethod.Time]: 'Time',
	[SortMethod.Status]: 'Status',
	[SortMethod.Name]: 'Name',
};

interface DashboardProps {
	sessions: ResolvedSession[];
	onExit: () => void;
	onIntervalChange?: (ms: number) => void;
}

export function Dashboard({
	sessions,
	onExit,
	onIntervalChange,
}: DashboardProps): React.ReactElement {
	const [mode, setMode] = useState<'watch' | 'select' | 'rename' | 'settings'>('watch');
	const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
	const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
	const [cursor, setCursor] = useState<number>(0);
	const [watchCursor, setWatchCursor] = useState<number>(0);
	const [customNames, setCustomNames] = useState<Map<string, string>>(new Map());
	const [renameBuffer, setRenameBuffer] = useState<string>('');
	const [intervalIdx, setIntervalIdx] = useState<number>(1);
	const prevStatusesRef = useRef<Map<string, SessionStatus>>(new Map());
	const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
	const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
	const [sortMethod, setSortMethod] = useState<SortMethod>(SortMethod.Time);
	const [settingsCursor, setSettingsCursor] = useState<number>(0);

	// Detect status transitions and update highlightedIds.
	useEffect(() => {
		const prev = prevStatusesRef.current;
		const next = new Set(highlightedIds);
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
		}
		for (const s of sessions) prev.set(s.sessionInfo.sessionId, s.status);
		setHighlightedIds(next);
	}, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

	const sortedSessions = [...sessions].sort((a, b) => {
		if (sortMethod === SortMethod.Time) {
			const ta = a.lastActiveMs ?? a.sessionInfo.updatedAt ?? 0;
			const tb = b.lastActiveMs ?? b.sessionInfo.updatedAt ?? 0;
			return tb - ta;
		}
		if (sortMethod === SortMethod.Status) {
			return STATUS_RANK[a.status] - STATUS_RANK[b.status];
		}
		return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
	});

	const selectSessions = sortedSessions;

	const clampedCursor = Math.min(cursor, Math.max(0, selectSessions.length - 1));

	const watchSessions = (
		watchedIds.size === 0
			? sortedSessions.filter((s) => s.status !== SessionStatus.Dead)
			: sortedSessions.filter(
					(s) => watchedIds.has(s.sessionInfo.sessionId) && s.status !== SessionStatus.Dead,
				)
	).filter((s) => !hiddenIds.has(s.sessionInfo.sessionId));

	const clampedWatchCursor = Math.min(watchCursor, Math.max(0, watchSessions.length - 1));

	useInput((input, key) => {
		if (mode === 'watch') {
			if (key.upArrow || input === 'k') {
				setWatchCursor((c) => Math.max(0, c - 1));
			} else if (key.downArrow || input === 'j') {
				setWatchCursor((c) => Math.min(watchSessions.length - 1, c + 1));
			} else if (input === 'd') {
				const id = watchSessions[clampedWatchCursor]?.sessionInfo.sessionId;
				if (id)
					setHighlightedIds((prev) => {
						const next = new Set(prev);
						next.delete(id);
						return next;
					});
			} else if (input === 'x') {
				const id = watchSessions[clampedWatchCursor]?.sessionInfo.sessionId;
				if (id) {
					setHiddenIds((prev) => {
						const next = new Set(prev);
						next.add(id);
						return next;
					});
					setWatchCursor((c) => Math.min(c, Math.max(0, watchSessions.length - 2)));
				}
			} else if (input === 's') {
				setPendingIds(new Set(watchSessions.map((s) => s.sessionInfo.sessionId)));
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
				setCursor((c) => (c - 1 + n) % n);
			} else if (key.downArrow || input === 'j') {
				setCursor((c) => (c + 1) % n);
			} else if (input === ' ') {
				const id = selectSessions[clampedCursor]?.sessionInfo.sessionId;
				if (id) {
					if (hiddenIds.has(id)) {
						setHiddenIds((prev) => {
							const next = new Set(prev);
							next.delete(id);
							return next;
						});
						setPendingIds((prev) => {
							const next = new Set(prev);
							next.add(id);
							return next;
						});
					} else {
						setPendingIds((prev) => {
							const next = new Set(prev);
							if (next.has(id)) next.delete(id);
							else next.add(id);
							return next;
						});
					}
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
					setCustomNames((prev) => {
						const next = new Map(prev);
						if (trimmed) next.set(id, trimmed);
						else next.delete(id);
						return next;
					});
				}
				setMode('select');
			} else if (key.escape) {
				setRenameBuffer('');
				setMode('select');
			} else if (input === '\x7f' || key.backspace) {
				setRenameBuffer((b) => b.slice(0, -1));
			} else if (input && !key.ctrl && !key.meta) {
				setRenameBuffer((b) => b + input);
			}
		} else if (mode === 'settings') {
			if (key.upArrow || input === 'k') {
				setSettingsCursor((c) => Math.max(0, c - 1));
			} else if (key.downArrow || input === 'j') {
				setSettingsCursor((c) => Math.min(1, c + 1));
			} else if (key.leftArrow || input === 'h') {
				if (settingsCursor === 0) {
					const newIdx = Math.max(0, intervalIdx - 1);
					if (newIdx !== intervalIdx) {
						setIntervalIdx(newIdx);
						onIntervalChange?.(PRESETS_MS[newIdx]);
					}
				} else {
					setSortMethod((m) => {
						const idx = SORT_METHODS.indexOf(m);
						return SORT_METHODS[(idx - 1 + SORT_METHODS.length) % SORT_METHODS.length];
					});
				}
			} else if (key.rightArrow || input === 'l') {
				if (settingsCursor === 0) {
					const newIdx = Math.min(PRESETS_MS.length - 1, intervalIdx + 1);
					if (newIdx !== intervalIdx) {
						setIntervalIdx(newIdx);
						onIntervalChange?.(PRESETS_MS[newIdx]);
					}
				} else {
					setSortMethod((m) => {
						const idx = SORT_METHODS.indexOf(m);
						return SORT_METHODS[(idx + 1) % SORT_METHODS.length];
					});
				}
			} else if (key.escape) {
				setMode('watch');
			}
		}
	});

	const title = <Text bold>CA Dashboard</Text>;

	if (mode === 'select' || mode === 'rename') {
		return (
			<Box flexDirection="column">
				{title}
				<SelectView
					sessions={selectSessions}
					checkedIds={pendingIds}
					cursor={clampedCursor}
					customNames={customNames}
					isRenaming={mode === 'rename'}
					renameValue={renameBuffer}
					hiddenIds={hiddenIds}
				/>
			</Box>
		);
	}

	if (mode === 'settings') {
		return (
			<Box flexDirection="column">
				{title}
				<SettingsView
					intervalMs={PRESETS_MS[intervalIdx]}
					presets={PRESETS_MS}
					labels={PRESET_LABELS}
					sortMethod={sortMethod}
					sortLabels={SORT_LABELS}
					settingsCursor={settingsCursor}
				/>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{title}
			<WatchView
				sessions={watchSessions}
				allSessions={sessions}
				cursor={clampedWatchCursor}
				highlightedIds={highlightedIds}
				customNames={customNames}
			/>
		</Box>
	);
}
