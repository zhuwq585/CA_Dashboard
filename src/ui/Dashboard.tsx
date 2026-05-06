import React, { useState } from 'react';
import { useInput } from 'ink';
import { SessionStatus } from '../types.js';
import type { ResolvedSession } from '../types.js';
import { WatchView } from './WatchView.js';
import { SelectView } from './SelectView.js';

interface DashboardProps {
	sessions: ResolvedSession[];
	onExit: () => void;
}

export function Dashboard({ sessions, onExit }: DashboardProps): React.ReactElement {
	const [mode, setMode]             = useState<'watch' | 'select'>('watch');
	const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
	const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
	const [cursor, setCursor]         = useState<number>(0);

	const selectSessions = sessions;

	const clampedCursor = Math.min(cursor, Math.max(0, selectSessions.length - 1));

	const watchSessions = watchedIds.size === 0
		? sessions.filter(s => s.status !== SessionStatus.Dead)
		: sessions.filter(s => watchedIds.has(s.sessionInfo.sessionId) && s.status !== SessionStatus.Dead);

	useInput((input, key) => {
		if (mode === 'watch') {
			if (input === 's') {
				setPendingIds(new Set(watchedIds));
				setCursor(0);
				setMode('select');
			} else if (input === 'q') {
				onExit();
			}
		} else {
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
			} else if (key.return) {
				setWatchedIds(new Set(pendingIds));
				setMode('watch');
			} else if (key.escape) {
				setMode('watch');
			}
		}
	});

	if (mode === 'select') {
		return (
			<SelectView
				sessions={selectSessions}
				checkedIds={pendingIds}
				cursor={clampedCursor}
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

	return <WatchView sessions={watchSessions} />;
}
